import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PythonPersistentKernel } from './pythonPersistentKernel';

class Mutex {
    private mutex = Promise.resolve();
    runExclusive<T>(callback: () => Promise<T>): Promise<T> {
        let release: () => void;
        const p = new Promise<void>(resolve => { release = resolve; });
        const result = this.mutex.then(callback);
        this.mutex = result.then(() => release(), () => release());
        return result;
    }
}

export class CBookController {
    readonly controllerId = 'cbook-controller';
    readonly notebookType = 'cbook-notebook';
    readonly label = 'CBook Kernel';
    readonly supportedLanguages = ['python', 'c', 'cpp', 'java', 'javascript'];

    private readonly _controller: vscode.NotebookController;
    private _executionOrder = 0;
    private _pythonHistory = new Map<string, string>(); // Legacy history, kept for fallback if needed, but primary is now persistent
    private _pythonKernel: PythonPersistentKernel | undefined;

    // Map to store pending input resolvers: inputRequestId -> resolve function
    private _pendingInputResolvers = new Map<string, (value: string) => void>();

    private _debugChannel: vscode.OutputChannel;
    private _rendererMessaging: vscode.NotebookRendererMessaging;

    constructor() {
        this._debugChannel = vscode.window.createOutputChannel('CBook Debug');
        this._controller = vscode.notebooks.createNotebookController(
            this.controllerId,
            this.notebookType,
            this.label
        );

        this._controller.supportedLanguages = this.supportedLanguages;
        this._controller.supportsExecutionOrder = true;
        this._controller.executeHandler = this._execute.bind(this);

        this._debugChannel.appendLine('CBook Kernel Activated');

        // Listen for messages from renderer
        this._rendererMessaging = vscode.notebooks.createRendererMessaging('cbook-renderer');
        this._rendererMessaging.onDidReceiveMessage((e) => {
            const message = e.message;
            if (message && message.type === 'cbook-input-response') {
                const userInput = message.value;
                if (message.requestId) {
                    const resolve = this._pendingInputResolvers.get(message.requestId);
                    if (resolve) {
                        resolve(userInput);
                        this._pendingInputResolvers.delete(message.requestId);
                    }
                } else {
                    // Fallback: Resolve the first pending one (FIFO)
                    const firstKey = this._pendingInputResolvers.keys().next().value;
                    if (firstKey) {
                        const resolve = this._pendingInputResolvers.get(firstKey);
                        if (resolve) {
                            resolve(userInput);
                            this._pendingInputResolvers.delete(firstKey);
                        }
                    }
                }
            }
        });

        // Listen for document changes to clear history
        vscode.workspace.onDidChangeNotebookDocument(e => {
            for (const change of e.contentChanges) {
                for (const cell of change.addedCells) {
                    // New cells don't have history yet
                }
                for (const cell of change.removedCells) {
                    this._pythonHistory.delete(cell.document.uri.toString());
                }
            }

            // Handle cell content changes
            for (const cellChange of e.cellChanges) {
                if (cellChange.document) {
                    this._pythonHistory.delete(cellChange.document.uri.toString());
                }
            }
        });

        // Listen for notebook close to clear all history for that notebook
        vscode.workspace.onDidCloseNotebookDocument(notebook => {
            for (const cell of notebook.getCells()) {
                this._pythonHistory.delete(cell.document.uri.toString());
            }
        });

        this._controller.interruptHandler = this._interrupt.bind(this);
    }

    private async _interrupt(notebook: vscode.NotebookDocument): Promise<void> {
        if (this._pythonKernel) {
            this._pythonKernel.interrupt();
        }
    }

    dispose() {
        this._controller.dispose();
        if (this._pythonKernel) {
            this._pythonKernel.dispose();
        }
    }

    private async _execute(
        cells: vscode.NotebookCell[],
        _notebook: vscode.NotebookDocument,
        _controller: vscode.NotebookController
    ): Promise<void> {
        for (const cell of cells) {
            await this._doExecution(cell);
        }
    }

    private async _doExecution(cell: vscode.NotebookCell): Promise<void> {
        const execution = this._controller.createNotebookCellExecution(cell);
        execution.executionOrder = ++this._executionOrder;
        execution.start(Date.now());

        // Check for Read-Only
        if (cell.metadata.cbook_readonly) {
            execution.replaceOutput([
                new vscode.NotebookCellOutput([
                    vscode.NotebookCellOutputItem.text('🔒 Read-Only Code Block. Execution skipped.', 'text/plain')
                ])
            ]);
            execution.end(true, Date.now());
            return;
        }

        try {
            const config = vscode.workspace.getConfiguration('cbook');
            const language = cell.document.languageId;
            let result = { raw: '', displayed: '' };

            if (language === 'python') {
                const token = execution.token;
                token.onCancellationRequested(() => {
                    this._pythonKernel?.interrupt();
                });
                result = await this._executePython(cell, config, execution);
            } else if (language === 'c') {
                result = await this._executeC(cell, config, execution);
            } else if (language === 'cpp') {
                result = await this._executeCpp(cell, config, execution);
            } else if (language === 'java') {
                result = await this._executeJava(cell, config, execution);
            } else if (language === 'javascript') {
                result = await this._executeJavascript(cell, config, execution);
            }

            // Unpack result
            const { raw: rawOutput, displayed: displayedText } = result;

            // Handle Plotting Output (Python only)
            const plotStart = '__PLOT_START__';
            const plotEnd = '__PLOT_END__';
            if (rawOutput.includes(plotStart) && rawOutput.includes(plotEnd)) {
                const parts = rawOutput.split(plotStart);
                const plotData = parts[1].split(plotEnd)[0];

                const items = [];
                // Remove plot data from text
                const cleanText = displayedText.replace(new RegExp(plotStart + '.*' + plotEnd, 's'), '').trim();

                if (cleanText) {
                    items.push(vscode.NotebookCellOutputItem.text(cleanText));
                }
                items.push(vscode.NotebookCellOutputItem.json(plotData, 'image/png'));

                execution.replaceOutput([new vscode.NotebookCellOutput(items)]);
            } else {
                execution.replaceOutput([
                    new vscode.NotebookCellOutput([
                        vscode.NotebookCellOutputItem.text(displayedText)
                    ])
                ]);
            }
            execution.end(true, Date.now());
        } catch (err: any) {
            if (err.message === 'Cancelled' || err.message === 'Execution Interrupted') {
                execution.replaceOutput([
                    new vscode.NotebookCellOutput([
                        vscode.NotebookCellOutputItem.text('Execution Cancelled', 'text/plain')
                    ])
                ]);
                execution.end(false, Date.now());
            } else {
                execution.replaceOutput([
                    new vscode.NotebookCellOutput([
                        vscode.NotebookCellOutputItem.error(err)
                    ])
                ]);
                execution.end(false, Date.now());
            }
        }
    }

    private async _runProcess(
        command: string,
        args: string[],
        execution: vscode.NotebookCellExecution,
        options: {
            cleanup?: () => void,
            startMarker?: string,
            onPlot?: (data: string) => void
        } = {}
    ): Promise<{ raw: string, displayed: string }> {
        return new Promise((resolve, reject) => {
            const child = cp.spawn(command, args);
            let displayedOutput = '';
            let fullStdoutBuffer = '';
            let streamBuffer = '';

            let stderr = '';
            let markerFound = !options.startMarker;

            const token = execution.token;
            const cancellation = token.onCancellationRequested(() => {
                child.kill();
                if (options.cleanup) options.cleanup();
                reject(new Error('Cancelled'));
            });

            const mutex = new Mutex();
            const updateOutput = async (items: vscode.NotebookCellOutputItem[] = []) => {
                await mutex.runExclusive(async () => {
                    const outputs: vscode.NotebookCellOutput[] = [];

                    if (displayedOutput) {
                        outputs.push(new vscode.NotebookCellOutput([
                            vscode.NotebookCellOutputItem.text(displayedOutput)
                        ]));
                    }

                    if (items.length > 0) {
                        outputs.push(new vscode.NotebookCellOutput(items));
                    }

                    await execution.replaceOutput(outputs);
                });
            };

            const cleanOutput = (text: string): string => {
                return text
                    .replace(/__CBOOK_MARKER__/g, '')
                    .replace(/__CBOOK_INPUT_START__/g, '')
                    .replace(/__CBOOK_INPUT_END__/g, '');
            };

            child.stdout.on('data', async (data) => {
                const str = data.toString();
                fullStdoutBuffer += str;
                streamBuffer += str;

                // Log removed for production optimization

                const startTag = '__CBOOK_INPUT_START__';
                const endTag = '__CBOOK_INPUT_END__';

                if (streamBuffer.includes(startTag) && streamBuffer.includes(endTag)) {

                    const startIndex = streamBuffer.indexOf(startTag);
                    const endIndex = streamBuffer.indexOf(endTag);

                    const preMarkerContent = streamBuffer.substring(0, startIndex);
                    const prompt = streamBuffer.substring(startIndex + startTag.length, endIndex);
                    const postRequestContent = streamBuffer.substring(endIndex + endTag.length);

                    let contentToDisplay = preMarkerContent;

                    if (!markerFound && options.startMarker) {
                        if (contentToDisplay.includes(options.startMarker)) {
                            markerFound = true;
                            const split = contentToDisplay.split(options.startMarker);
                            contentToDisplay = split.slice(1).join(options.startMarker);

                            if (contentToDisplay.startsWith('\n')) {
                                contentToDisplay = contentToDisplay.substring(1);
                            } else if (contentToDisplay.startsWith('\r\n')) {
                                contentToDisplay = contentToDisplay.substring(2);
                            }
                        } else {
                            contentToDisplay = '';
                        }
                    }

                    if (!markerFound) {
                        markerFound = true;
                    }

                    if (markerFound && contentToDisplay) {
                        displayedOutput += cleanOutput(contentToDisplay);
                    }

                    if (markerFound) {
                        await updateOutput();
                    }

                    // Clear buffer but keep the rest
                    streamBuffer = postRequestContent;

                    const inputRequestId = `${execution.cell.document.uri.toString()}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

                    const inputPromise = new Promise<string>(resolveInput => {
                        this._pendingInputResolvers.set(inputRequestId, resolveInput);
                    });

                    await updateOutput([
                        vscode.NotebookCellOutputItem.json({
                            type: 'cbook-input-request',
                            prompt: prompt,
                            requestId: inputRequestId
                        }, 'application/vnd.cbook.input')
                    ]);

                    const userInput = await inputPromise;

                    if (userInput !== undefined) {
                        try {
                            child.stdin.write(userInput + '\r\n');
                        } catch (err) {
                            console.error('Error writing to stdin:', err);
                        }
                        if (markerFound) {
                            displayedOutput += cleanOutput(prompt) + userInput + '\n';
                            await updateOutput();
                        }
                    } else {
                        child.stdin.write('\n');
                        if (markerFound) {
                            displayedOutput += '<cancelled>\n';
                            await updateOutput();
                        }
                    }

                } else {
                    // Only display if NO partial tag risk
                    let safeToDisplay = true;
                    for (let i = 1; i < startTag.length; i++) {
                        if (streamBuffer.endsWith(startTag.substring(0, i))) {
                            safeToDisplay = false;
                            break;
                        }
                    }
                    if (streamBuffer.includes(startTag)) safeToDisplay = false; // Wait for end tag

                    if (safeToDisplay) {
                        let contentToDisplay = streamBuffer;

                        if (!markerFound && options.startMarker) {
                            if (contentToDisplay.includes(options.startMarker)) {
                                markerFound = true;
                                const split = contentToDisplay.split(options.startMarker);
                                contentToDisplay = split.slice(1).join(options.startMarker);

                                if (contentToDisplay.startsWith('\n')) {
                                    contentToDisplay = contentToDisplay.substring(1);
                                } else if (contentToDisplay.startsWith('\r\n')) {
                                    contentToDisplay = contentToDisplay.substring(2);
                                }
                            } else {
                                contentToDisplay = '';
                            }
                        }

                        if (markerFound && contentToDisplay) {
                            if (!contentToDisplay.includes('__PLOT_START__') && !contentToDisplay.includes('__PLOT_END__')) {
                                displayedOutput += cleanOutput(contentToDisplay);
                                updateOutput();
                            }
                        }
                        streamBuffer = '';
                    }
                }
            });

            child.stderr.on('data', (data) => {
                stderr += data.toString();
                if (markerFound) {
                    displayedOutput += cleanOutput(data.toString());
                    updateOutput();
                }
            });

            child.on('close', (code) => {
                cancellation.dispose();
                if (options.cleanup) options.cleanup();

                if (code === 0) {
                    resolve({ raw: fullStdoutBuffer, displayed: displayedOutput });
                } else {
                    if (execution.token.isCancellationRequested) {
                        reject(new Error('Cancelled'));
                    } else {
                        reject(new Error(stderr || displayedOutput || fullStdoutBuffer));
                    }
                }
            });

            child.on('error', (err) => {
                cancellation.dispose();
                if (options.cleanup) options.cleanup();
                reject(err);
            });
        });
    }

    private async _executePython(cell: vscode.NotebookCell, config: vscode.WorkspaceConfiguration, execution: vscode.NotebookCellExecution): Promise<{ raw: string, displayed: string }> {
        const pythonPath = config.get<string>('pythonPath') || 'python';
        const isStateless = cell.metadata.cbook_stateless === true;
        let kernelToUse = this._pythonKernel;

        if (isStateless || !kernelToUse) {
            // If stateless, creating a fresh, isolated kernel.
            // If main kernel missing, create it (standard logic).
            const newKernel = new PythonPersistentKernel(pythonPath);
            if (isStateless) {
                kernelToUse = newKernel;
            } else {
                this._pythonKernel = newKernel;
                kernelToUse = this._pythonKernel;
            }
        }

        let fullCode = cell.document.getText();

        // Add Plotting Injection
        const plotInjection = `
try:
    import matplotlib.pyplot as plt
    import io
    import base64
    if plt.get_fignums():
        buf = io.BytesIO()
        plt.savefig(buf, format='png')
        buf.seek(0)
        img_str = base64.b64encode(buf.read()).decode('utf-8')
        print("__PLOT_START__" + img_str + "__PLOT_END__", flush=True)
        plt.close()
except ImportError:
    pass
except Exception:
    pass
`;
        fullCode += "\n" + plotInjection;

        let displayedOutput = '';

        const updateOutput = async (items: vscode.NotebookCellOutputItem[] = []) => {
            const outputs: vscode.NotebookCellOutput[] = [];
            if (displayedOutput) {
                outputs.push(new vscode.NotebookCellOutput([
                    vscode.NotebookCellOutputItem.text(displayedOutput)
                ]));
            }
            if (items.length > 0) {
                outputs.push(new vscode.NotebookCellOutput(items));
            }
            await execution.replaceOutput(outputs);
        };

        const kernelResult = kernelToUse.execute(fullCode,
            (data) => {
                if (!data.includes('__PLOT_START__')) {
                    displayedOutput += data;
                    updateOutput();
                }
            },
            async (prompt) => {
                const inputRequestId = `${execution.cell.document.uri.toString()}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

                const inputPromise = new Promise<string>(resolveInput => {
                    this._pendingInputResolvers.set(inputRequestId, resolveInput);
                });

                // 1. Show Widget (Prompt is shown in the widget)
                await updateOutput([
                    vscode.NotebookCellOutputItem.json({
                        type: 'cbook-input-request',
                        prompt: prompt,
                        requestId: inputRequestId
                    }, 'application/vnd.cbook.input')
                ]);

                // 2. Wait for answer
                const val = await inputPromise;

                // 3. Input done. Append prompt + value to history (echo)
                displayedOutput += prompt + val + "\n";

                // 4. Update to remove widget and show echoing
                await updateOutput();

                return val;
            }
        );

        // IMPORTANT: Return our manually constructed displayedOutput because the kernel buffer
        // (returned by execute) might be missing the prompt/input echoes we added manually.
        // We still return raw from the kernel for plotting/debugging.
        const result = {
            raw: (await kernelResult).raw,
            displayed: displayedOutput
        };

        if (isStateless) {
            kernelToUse.dispose();
        }

        return result;
    }

    private async _executeJavascript(cell: vscode.NotebookCell, config: vscode.WorkspaceConfiguration, execution: vscode.NotebookCellExecution): Promise<{ raw: string, displayed: string }> {
        const code = cell.document.getText();
        const tempDir = os.tmpdir();
        const sourcePath = path.join(tempDir, `temp_${Date.now()}.js`);
        fs.writeFileSync(sourcePath, code);

        return new Promise((resolve, reject) => {
            cp.exec(`node "${sourcePath}"`, (err, stdout, stderr) => {
                // Cleanup
                if (fs.existsSync(sourcePath)) fs.unlinkSync(sourcePath);

                if (err && !stdout) { // If error and no stdout, execute failed hard
                    execution.replaceOutput([new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.error(new Error(stderr || err.message))])]);
                    resolve({ raw: stderr, displayed: stderr });
                    return;
                }

                // Node output
                const output = stdout + stderr;
                resolve({ raw: output, displayed: output });
            });
        });
    }

    private async _executeC(cell: vscode.NotebookCell, config: vscode.WorkspaceConfiguration, execution: vscode.NotebookCellExecution): Promise<{ raw: string, displayed: string }> {
        const gccPath = config.get<string>('gccPath') || 'gcc';
        let code = cell.document.getText();

        const inputHelper = `
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
#include <io.h>
#define F_OK 0
#else
#include <unistd.h>
#endif

char* cbook_input(const char* prompt) {
    printf("__CBOOK_INPUT_START__%s__CBOOK_INPUT_END__", prompt);
    fflush(stdout);
    static char buffer[1024];
    if (fgets(buffer, sizeof(buffer), stdin) != NULL) {
        size_t len = strlen(buffer);
        if (len > 0 && buffer[len-1] == '\\n') {
            buffer[len-1] = '\\0';
            len--;
        }
        if (len > 0 && buffer[len-1] == '\\r') {
            buffer[len-1] = '\\0';
        }
        return buffer;
    }
    return "";
}
`;
        code = inputHelper + "\n" + code;

        const tempDir = os.tmpdir();
        const sourcePath = path.join(tempDir, `temp_${Date.now()}.c`);
        const exePath = path.join(tempDir, `temp_${Date.now()}.exe`);

        fs.writeFileSync(sourcePath, code);

        const compileCmd = `"${gccPath}" "${sourcePath}" -o "${exePath}"`;

        return new Promise((resolve, reject) => {
            cp.exec(compileCmd, async (err, stdout, stderr) => {
                if (err) {
                    if (fs.existsSync(sourcePath)) fs.unlinkSync(sourcePath);
                    execution.replaceOutput([new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.error(new Error(stderr || stdout))])]);
                    reject(new Error(stderr || stdout));
                    return;
                }

                try {
                    const result = await this._runProcess(exePath, [], execution, {
                        cleanup: () => {
                            if (fs.existsSync(sourcePath)) fs.unlinkSync(sourcePath);
                            if (fs.existsSync(exePath)) fs.unlinkSync(exePath);
                        }
                    });
                    resolve(result);
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    private async _executeCpp(cell: vscode.NotebookCell, config: vscode.WorkspaceConfiguration, execution: vscode.NotebookCellExecution): Promise<{ raw: string, displayed: string }> {
        const gppPath = config.get<string>('gppPath') || 'g++';
        let code = cell.document.getText();

        const inputHelper = `
#include <iostream>
#include <string>
#include <cstdio>

std::string cbook_input(const std::string& prompt) {
    std::cout << "__CBOOK_INPUT_START__" << prompt << "__CBOOK_INPUT_END__";
    std::cout.flush();
    std::string line;
    std::getline(std::cin, line);
    return line;
}
`;
        code = inputHelper + "\n" + code;

        const tempDir = os.tmpdir();
        const sourcePath = path.join(tempDir, `temp_${Date.now()}.cpp`);
        const exePath = path.join(tempDir, `temp_${Date.now()}.exe`);

        fs.writeFileSync(sourcePath, code);
        const compileCmd = `"${gppPath}" "${sourcePath}" -o "${exePath}"`;

        return new Promise((resolve, reject) => {
            cp.exec(compileCmd, async (err, stdout, stderr) => {
                if (err) {
                    if (fs.existsSync(sourcePath)) fs.unlinkSync(sourcePath);
                    execution.replaceOutput([new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.error(new Error(stderr || stdout))])]);
                    reject(new Error(stderr || stdout));
                    return;
                }

                try {
                    const result = await this._runProcess(exePath, [], execution, {
                        cleanup: () => {
                            if (fs.existsSync(sourcePath)) fs.unlinkSync(sourcePath);
                            if (fs.existsSync(exePath)) fs.unlinkSync(exePath);
                        }
                    });
                    resolve(result);
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    private async _executeJava(cell: vscode.NotebookCell, config: vscode.WorkspaceConfiguration, execution: vscode.NotebookCellExecution): Promise<{ raw: string, displayed: string }> {
        const javacPath = config.get<string>('javacPath') || 'javac';
        const javaPath = config.get<string>('javaPath') || 'java';
        let code = cell.document.getText();

        let className = 'Main';
        const match = code.match(/(?:public\s+)?class\s+(\w+)/);
        if (match) {
            className = match[1];
        } else {
            const imports = code.match(/^import\s+.*;/gm) || [];
            const body = code.replace(/^import\s+.*;/gm, '');
            code = `${imports.join('\n')}\npublic class Main {\n    public static void main(String[] args) {\n${body}\n    }\n}`;
        }

        const lastBraceIndex = code.lastIndexOf('}');
        if (lastBraceIndex !== -1) {
            const helper = `
    public static String cbook_input(String prompt) {
        System.out.print("__CBOOK_INPUT_START__" + prompt + "__CBOOK_INPUT_END__");
        System.out.flush();
        try {
            java.io.BufferedReader reader = new java.io.BufferedReader(new java.io.InputStreamReader(System.in));
            return reader.readLine();
        } catch (java.io.IOException e) {
            return "";
        }
    }
`;
            code = code.slice(0, lastBraceIndex) + helper + code.slice(lastBraceIndex);
        }

        const tempDir = os.tmpdir();
        const sourcePath = path.join(tempDir, `${className}.java`);

        fs.writeFileSync(sourcePath, code);

        return new Promise((resolve, reject) => {
            cp.exec(`"${javacPath}" "${sourcePath}"`, async (err, stdout, stderr) => {
                if (err) {
                    if (fs.existsSync(sourcePath)) fs.unlinkSync(sourcePath);
                    execution.replaceOutput([new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.error(new Error(stderr || stdout))])]);
                    reject(new Error(stderr || stdout));
                    return;
                }

                try {
                    const result = await this._runProcess(javaPath, ['-cp', tempDir, className], execution, {
                        cleanup: () => {
                            if (fs.existsSync(sourcePath)) fs.unlinkSync(sourcePath);
                            const classFile = path.join(tempDir, `${className}.class`);
                            if (fs.existsSync(classFile)) fs.unlinkSync(classFile);
                        }
                    });
                    resolve(result);
                } catch (e) {
                    reject(e);
                }
            });
        });
    }
}
