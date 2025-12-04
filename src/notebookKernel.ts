import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export class CBookController {
    readonly controllerId = 'cbook-controller';
    readonly notebookType = 'cbook-notebook';
    readonly label = 'CBook Kernel';
    readonly supportedLanguages = ['python', 'c', 'cpp', 'java'];

    private readonly _controller: vscode.NotebookController;
    private _executionOrder = 0;
    private _pythonHistory = new Map<string, string>(); // cellURI -> code

    constructor() {
        this._controller = vscode.notebooks.createNotebookController(
            this.controllerId,
            this.notebookType,
            this.label
        );

        this._controller.supportedLanguages = this.supportedLanguages;
        this._controller.supportsExecutionOrder = true;
        this._controller.executeHandler = this._execute.bind(this);

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
    }

    dispose() {
        this._controller.dispose();
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
            let output = '';

            if (language === 'python') {
                output = await this._executePython(cell, config);
            } else if (language === 'c') {
                output = await this._executeC(cell, config);
            } else if (language === 'cpp') {
                output = await this._executeCpp(cell, config);
            } else if (language === 'java') {
                output = await this._executeJava(cell, config);
            }

            // Handle Plotting Output (Python only)
            const plotStart = '__PLOT_START__';
            const plotEnd = '__PLOT_END__';
            if (output.includes(plotStart) && output.includes(plotEnd)) {
                const parts = output.split(plotStart);
                const textOutput = parts[0];
                const plotData = parts[1].split(plotEnd)[0];

                const items = [];
                if (textOutput.trim()) {
                    items.push(vscode.NotebookCellOutputItem.text(textOutput));
                }
                items.push(vscode.NotebookCellOutputItem.json(plotData, 'image/png'));

                execution.replaceOutput([new vscode.NotebookCellOutput(items)]);
            } else {
                execution.replaceOutput([
                    new vscode.NotebookCellOutput([
                        vscode.NotebookCellOutputItem.text(output)
                    ])
                ]);
            }

            execution.end(true, Date.now());
        } catch (err: any) {
            execution.replaceOutput([
                new vscode.NotebookCellOutput([
                    vscode.NotebookCellOutputItem.error(err)
                ])
            ]);
            execution.end(false, Date.now());
        }
    }

    private async _executePython(cell: vscode.NotebookCell, config: vscode.WorkspaceConfiguration): Promise<string> {
        const pythonPath = config.get<string>('pythonPath') || 'python';
        const cellUri = cell.document.uri.toString();
        const currentCode = cell.document.getText();

        // Build history code
        let fullCode = '';
        for (const [uri, code] of this._pythonHistory) {
            if (uri !== cellUri) { // Don't include self if already in map (shouldn't be if logic is correct)
                fullCode += code + '\n';
            }
        }

        const marker = `print("__CBOOK_MARKER__")`;

        // Input interception injection
        const inputInjection = `
import sys
def input(prompt=''):
    print(f"__CBOOK_INPUT_REQUEST__{prompt}")
    sys.stdout.flush()
    return sys.stdin.readline().rstrip('\\n')
`;
        fullCode += inputInjection + '\n';
        fullCode += marker + '\n';
        fullCode += currentCode + '\n';

        // Plotting injection
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
        print("__PLOT_START__" + img_str + "__PLOT_END__")
        plt.close()
except ImportError:
    pass
except Exception:
    pass
`;
        fullCode += plotInjection;

        return new Promise((resolve, reject) => {
            const child = cp.spawn(pythonPath, ['-u', '-c', fullCode]);
            let stdout = '';
            let stderr = '';

            child.stdout.on('data', async (data) => {
                const str = data.toString();
                if (str.includes('__CBOOK_INPUT_REQUEST__')) {
                    const prompt = str.split('__CBOOK_INPUT_REQUEST__')[1].trim();
                    const userInput = await vscode.window.showInputBox({ prompt: prompt || 'Input required' });
                    if (userInput !== undefined) {
                        child.stdin.write(userInput + '\n');
                    } else {
                        child.stdin.write('\n'); // Send empty if cancelled
                    }
                } else {
                    stdout += str;
                }
            });

            child.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            child.on('close', (code) => {
                if (code === 0) {
                    // Update history on success
                    this._pythonHistory.set(cellUri, currentCode);

                    // Parse output to remove history
                    const parts = stdout.split('__CBOOK_MARKER__');
                    const relevantOutput = parts.length > 1 ? parts[1].trim() : stdout.trim();
                    resolve(relevantOutput);
                } else {
                    reject(new Error(stderr || stdout));
                }
            });
        });
    }

    private async _executeC(cell: vscode.NotebookCell, config: vscode.WorkspaceConfiguration): Promise<string> {
        const gccPath = config.get<string>('gccPath') || 'gcc';
        const code = cell.document.getText();
        const tempDir = os.tmpdir();
        const sourcePath = path.join(tempDir, `temp_${Date.now()}.c`);
        const exePath = path.join(tempDir, `temp_${Date.now()}.exe`);

        fs.writeFileSync(sourcePath, code);

        return new Promise((resolve, reject) => {
            cp.exec(`"${gccPath}" "${sourcePath}" -o "${exePath}"`, (err, stdout, stderr) => {
                if (err) {
                    fs.unlinkSync(sourcePath);
                    reject(new Error(stderr || stdout));
                    return;
                }

                cp.exec(`"${exePath}"`, (err, stdout, stderr) => {
                    // Cleanup
                    if (fs.existsSync(sourcePath)) fs.unlinkSync(sourcePath);
                    if (fs.existsSync(exePath)) fs.unlinkSync(exePath);

                    if (err) {
                        reject(new Error(stderr || stdout));
                    } else {
                        resolve(stdout);
                    }
                });
            });
        });
    }

    private async _executeCpp(cell: vscode.NotebookCell, config: vscode.WorkspaceConfiguration): Promise<string> {
        const gppPath = config.get<string>('gppPath') || 'g++';
        const code = cell.document.getText();
        const tempDir = os.tmpdir();
        const sourcePath = path.join(tempDir, `temp_${Date.now()}.cpp`);
        const exePath = path.join(tempDir, `temp_${Date.now()}.exe`);

        fs.writeFileSync(sourcePath, code);

        return new Promise((resolve, reject) => {
            cp.exec(`"${gppPath}" "${sourcePath}" -o "${exePath}"`, (err, stdout, stderr) => {
                if (err) {
                    fs.unlinkSync(sourcePath);
                    reject(new Error(stderr || stdout));
                    return;
                }

                cp.exec(`"${exePath}"`, (err, stdout, stderr) => {
                    // Cleanup
                    if (fs.existsSync(sourcePath)) fs.unlinkSync(sourcePath);
                    if (fs.existsSync(exePath)) fs.unlinkSync(exePath);

                    if (err) {
                        reject(new Error(stderr || stdout));
                    } else {
                        resolve(stdout);
                    }
                });
            });
        });
    }

    private async _executeJava(cell: vscode.NotebookCell, config: vscode.WorkspaceConfiguration): Promise<string> {
        const javacPath = config.get<string>('javacPath') || 'javac';
        const javaPath = config.get<string>('javaPath') || 'java';
        let code = cell.document.getText();

        let className = 'Main';
        // Smart class detection
        const match = code.match(/(?:public\s+)?class\s+(\w+)/);
        if (match) {
            className = match[1];
        } else {
            // Wrap in Main class
            // Extract imports first (naive)
            const imports = code.match(/^import\s+.*;/gm) || [];
            const body = code.replace(/^import\s+.*;/gm, '');
            code = `${imports.join('\n')}\npublic class Main {\n    public static void main(String[] args) {\n${body}\n    }\n}`;
        }

        const tempDir = os.tmpdir();
        const sourcePath = path.join(tempDir, `${className}.java`);

        fs.writeFileSync(sourcePath, code);

        return new Promise((resolve, reject) => {
            cp.exec(`"${javacPath}" "${sourcePath}"`, (err, stdout, stderr) => {
                if (err) {
                    if (fs.existsSync(sourcePath)) fs.unlinkSync(sourcePath);
                    reject(new Error(stderr || stdout));
                    return;
                }

                cp.exec(`"${javaPath}" -cp "${tempDir}" ${className}`, (err, stdout, stderr) => {
                    // Cleanup
                    if (fs.existsSync(sourcePath)) fs.unlinkSync(sourcePath);
                    const classFile = path.join(tempDir, `${className}.class`);
                    if (fs.existsSync(classFile)) fs.unlinkSync(classFile);

                    if (err) {
                        reject(new Error(stderr || stdout));
                    } else {
                        resolve(stdout);
                    }
                });
            });
        });
    }
}
