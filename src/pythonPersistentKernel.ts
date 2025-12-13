import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';

export class PythonPersistentKernel {
    private _process: cp.ChildProcess | undefined;
    private _buffer: string = '';
    private _waitingForMarker: string | null = null;
    private _resolveExecution: ((result: { raw: string, displayed: string }) => void) | null = null;
    private _rejectExecution: ((err: Error) => void) | null = null;
    private _executionPromise: Promise<{ raw: string, displayed: string }> | null = null;
    private _isBootstrapComplete = false;
    private _pythonPath: string;

    constructor(pythonPath: string) {
        this._pythonPath = pythonPath;
    }

    public async execute(code: string, onOutput: (data: string) => void, onInput?: (prompt: string) => Promise<string>): Promise<{ raw: string, displayed: string }> {
        if (!this._process) {
            await this._startProcess();
        }

        // Wait for previous execution to finish (simple queueing)
        if (this._executionPromise) {
            try {
                await this._executionPromise;
            } catch (e) { /* ignore previous error */ }
        }

        const marker = `__CBOOK_END_${Date.now()}_${Math.random().toString(36).substr(2, 5)}__`;

        // Prepare code for transmission
        // We wrap it to ensure it executes safely and prints the marker
        // We use a helper function in the persistent process
        // But for now, let's send it raw with a print at the end, handling indentation

        // Better approach: The bootstrap script defines an `execute_code_block(code)` function
        // that handles the exec and printing.

        // Escape the code to be passed as a string literal to the python function
        const encodedCode = Buffer.from(code).toString('base64');
        const cmd = `__cbook_run_cell__("${encodedCode}", "${marker}")\n`;

        this._waitingForMarker = marker;
        this._buffer = '';

        this._executionPromise = new Promise((resolve, reject) => {
            this._resolveExecution = resolve;
            this._rejectExecution = reject;

            // Output handling logic logic moved to _startProcess listeners
        });

        // Set up temporary input/output handlers for this execution
        this._currentInputHandler = onInput;
        this._currentOutputHandler = onOutput;

        // Send command
        try {
            this._process!.stdin?.write(cmd);
        } catch (err) {
            this._rejectExecution?.(err as Error);
            this._process = undefined; // Force restart next time
        }

        return this._executionPromise;
    }

    public interrupt() {
        // Python on Windows is hard to interrupt with signals.
        // Best reliability for "Stop" is to kill and restart.
        // It loses state, but "Stop" usually implies "I want this to stop NOW".
        // Jupyter kernels try to send signal, but often fallback.
        // For this extension, Restart is safer to guarantee stop.
        if (this._process) {
            this._process.kill();
            this._process = undefined;
        }
        if (this._rejectExecution) {
            this._rejectExecution(new Error('Execution Interrupted'));
            this._resolveExecution = null;
            this._rejectExecution = null;
        }
    }

    private _currentInputHandler: ((prompt: string) => Promise<string>) | undefined;
    private _currentOutputHandler: ((data: string) => void) | undefined;

    private async _startProcess(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                // -u for unbuffered binary stdout/stderr
                this._process = cp.spawn(this._pythonPath, ['-u', '-i'], {
                    env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
                });

                // Monitor for startup errors
                this._process.on('error', (err) => {
                    reject(new Error(`Failed to start python process: ${err.message}`));
                });

                this._process.on('exit', (code) => {
                    if (!this._isBootstrapComplete) {
                        reject(new Error(`Python process exited prematurely with code ${code}`));
                    }
                    this._process = undefined;
                });

                this._process.stdout?.on('data', async (data) => {
                    const str = data.toString();

                    // INPUT HANDLING
                    if (str.includes('__CBOOK_INPUT_REQUEST__')) {
                        const parts = str.split('__CBOOK_INPUT_REQUEST__');
                        const preContent = parts[0];
                        const prompt = parts[1] || '';

                        // If there was content before the request (e.g. prints), emit it
                        if (preContent) {
                            this._buffer += preContent;
                            this._currentOutputHandler?.(preContent);
                        }

                        if (this._currentInputHandler) {
                            const input = await this._currentInputHandler(prompt);
                            this._process?.stdin?.write(input + '\n');
                        } else {
                            this._process?.stdin?.write('\n'); // No handler, send empty
                        }
                        return; // Don't show the request tag in output/buffer
                    }

                    // Check for marker
                    let contentToProcess = str;
                    if (this._waitingForMarker && contentToProcess.includes(this._waitingForMarker)) {
                        const parts = contentToProcess.split(this._waitingForMarker);
                        contentToProcess = parts[0];

                        this._buffer += contentToProcess;

                        // Emit final chunk
                        if (contentToProcess) {
                            this._currentOutputHandler?.(contentToProcess);
                        }

                        if (this._resolveExecution) {
                            // We stream, but we also resolve full at end
                            this._resolveExecution({ raw: this._buffer, displayed: this._buffer });
                            this._resolveExecution = null;
                            this._rejectExecution = null;
                            this._waitingForMarker = null;
                            this._buffer = '';
                        }
                    } else {
                        // Normal chunk
                        this._buffer += str;
                        this._currentOutputHandler?.(str);
                    }
                });

                this._process.stderr?.on('data', (data) => {
                    const str = data.toString();
                    this._buffer += str;
                    this._currentOutputHandler?.(str);
                });

                // Send bootstrap code
                const bootstrap = `
import sys
import base64
import io
import traceback
import builtins

# Override input to talk to our kernel
original_input = builtins.input
def input(prompt=''):
    print(f"__CBOOK_INPUT_REQUEST__{prompt}", end='', flush=True)
    return original_input()


# Try to set Agg backend for matplotlib to prevent blocking windows
try:
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    
    def show():
        try:
            buf = io.BytesIO()
            plt.savefig(buf, format='png')
            buf.seek(0)
            img_str = base64.b64encode(buf.read()).decode('utf-8')
            print(f"__PLOT_START__{img_str}__PLOT_END__", flush=True)
            plt.close('all')
        except Exception:
            traceback.print_exc()

    # Monkey patch plt.show
    plt.show = show
except ImportError:
    pass

builtins.input = input

def __cbook_run_cell__(b64_code, marker):
    try:
        code = base64.b64decode(b64_code).decode('utf-8')
        # We use exec to run the code in the global namespace
        exec(code, globals())
    except Exception:
        traceback.print_exc()
    finally:
        print(marker, flush=True)

print("READY", flush=True)
`;
                this._process.stdin?.write(bootstrap + '\n');

                // Wait for "READY" with timeout
                let checks = 0;
                const readyCheck = setInterval(() => {
                    checks++;
                    if (this._buffer.includes('READY')) {
                        clearInterval(readyCheck);
                        this._buffer = ''; // Clear ready message
                        this._isBootstrapComplete = true;
                        resolve();
                    }

                    if (checks > 50) { // 5 seconds timeout
                        clearInterval(readyCheck);
                        this.dispose();
                        reject(new Error("Timeout waiting for Python kernel to start. Check your python path setting."));
                    }
                }, 100);

            } catch (err) {
                reject(err);
            }
        });
    }

    public dispose() {
        if (this._process) {
            this._process.kill();
            this._process = undefined;
        }
        // Fix: Reject any pending execution so the UI doesn't hang forever
        if (this._rejectExecution) {
            this._rejectExecution(new Error("Kernel disposed"));
            this._resolveExecution = null;
            this._rejectExecution = null;
            this._executionPromise = null;
        }
    }

    public restart() {
        this.dispose();
    }
}
