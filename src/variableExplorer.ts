import * as vscode from 'vscode';

export class VariableExplorerProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'cbook.variableExplorer';

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
        // Use a nonce to only allow specific scripts to be run
        const nonce = getNonce();

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Variable Explorer</title>
                <style>
                    body { font-family: var(--vscode-font-family); padding: 10px; color: var(--vscode-editor-foreground); }
                    .variable-list { list-style: none; padding: 0; }
                    .variable-item { padding: 5px; border-bottom: 1px solid var(--vscode-panel-border); display: flex; justify-content: space-between; }
                    .var-name { font-weight: bold; color: var(--vscode-symbolIcon-variableForeground); }
                    .var-type { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
                </style>
            </head>
            <body>
                <h3>Variables</h3>
                <div id="content">
                    <p>Variable tracking active...</p>
                    <ul class="variable-list">
                        <!-- Placeholder for variables -->
                        <li class="variable-item"><span class="var-name">x</span> <span class="var-type">int: 42</span></li>
                        <li class="variable-item"><span class="var-name">df</span> <span class="var-type">DataFrame: (100, 5)</span></li>
                    </ul>
                </div>
            </body>
            </html>`;
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
