import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export async function exportToHTML() {
    const editor = vscode.window.activeNotebookEditor;
    if (!editor) {
        vscode.window.showErrorMessage('No active notebook to export.');
        return;
    }

    const notebook = editor.notebook;
    const notebookUri = notebook.uri;
    const htmlPath = notebookUri.fsPath.replace(/\.cbook$/, '.html');

    let htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CBook Export</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; line-height: 1.6; }
        pre { background: #f4f4f4; padding: 15px; border-radius: 5px; overflow-x: auto; }
        code { font-family: 'Consolas', 'Monaco', 'Courier New', monospace; }
        .cell { margin-bottom: 20px; border: 1px solid #ddd; padding: 15px; border-radius: 8px; }
        .cell-markdown { border: none; padding: 0; }
        .cell-code { background: #fafafa; }
        .output { margin-top: 10px; border-top: 1px solid #eee; padding-top: 10px; }
        img { max-width: 100%; }
    </style>
</head>
<body>
    <h1>${path.basename(notebookUri.fsPath)}</h1>
`;

    for (const cell of notebook.getCells()) {
        if (cell.kind === vscode.NotebookCellKind.Markup) {
            // Simple Markdown rendering (replace with a real library if possible, but for now basic regex)
            let md = cell.document.getText();
            // Basic Bold/Italic
            md = md.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
            md = md.replace(/\*(.*?)\*/g, '<em>$1</em>');
            // Images
            md = md.replace(/!\[(.*?)\]\((.*?)\)/g, '<img src="$2" alt="$1">');

            htmlContent += `<div class="cell cell-markdown">${md}</div>`;
        } else {
            const lang = cell.document.languageId;
            const code = cell.document.getText();
            htmlContent += `
            <div class="cell cell-code">
                <pre><code class="language-${lang}">${escapeHtml(code)}</code></pre>
            `;

            // Outputs
            // Note: This is tricky because outputs are complex objects. 
            // We'll try to grab text/plain or image/png
            /*
            // Accessing outputs synchronously here is hard because they might not be fully rendered in the model in a simple way 
            // without using the serializer or inspecting the cell outputs array.
            */
            if (cell.outputs.length > 0) {
                htmlContent += `<div class="output">`;
                for (const output of cell.outputs) {
                    for (const item of output.items) {
                        if (item.mime === 'text/plain') {
                            const text = new TextDecoder().decode(item.data);
                            htmlContent += `<pre>${escapeHtml(text)}</pre>`;
                        } else if (item.mime === 'image/png') {
                            // Base64 image
                            // The data is Uint8Array
                            // We need to convert it to base64 string
                            const b64 = Buffer.from(item.data).toString('base64');
                            htmlContent += `<img src="data:image/png;base64,${b64}" />`;
                        }
                    }
                }
                htmlContent += `</div>`;
            }

            htmlContent += `</div>`;
        }
    }

    htmlContent += `</body></html>`;

    fs.writeFileSync(htmlPath, htmlContent);
    vscode.window.showInformationMessage(`Exported to ${htmlPath}`);
}

function escapeHtml(unsafe: string) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
