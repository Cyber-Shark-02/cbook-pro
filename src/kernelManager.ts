import * as vscode from 'vscode';

export class KernelManagerProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'cbook.kernelManager';

    constructor(
        private readonly _extensionUri: vscode.Uri,
    ) { }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Kernel Manager</title>
                <style>
                    body { font-family: var(--vscode-font-family); padding: 10px; color: var(--vscode-editor-foreground); }
                    .status { margin-bottom: 10px; padding: 5px; background: var(--vscode-textBlockQuote-background); border-left: 3px solid var(--vscode-textBlockQuote-border); }
                    .btn { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 5px 10px; cursor: pointer; }
                    .btn:hover { background: var(--vscode-button-hoverBackground); }
                </style>
            </head>
            <body>
                <h3>Kernel Status</h3>
                <div class="status">
                    <strong>Active Kernel:</strong> CBook Polyglot
                </div>
                <div class="status">
                    <strong>Python:</strong> Ready (Persistent)<br>
                    <strong>JavaScript:</strong> Ready<br>
                    <strong>GCC:</strong> Ready<br>
                    <strong>Java:</strong> Ready
                </div>
                <button class="btn">Restart Kernel</button>
            </body>
            </html>`;
    }
}
