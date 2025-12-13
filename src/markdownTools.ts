import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export function toggleFormat(startTag: string, endTag: string) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return; }

    const selection = editor.selection;
    const text = editor.document.getText(selection);

    // Smart Toggle Logic
    if (text.startsWith(startTag) && text.endsWith(endTag)) {
        // Unwrap
        const unwrap = text.substring(startTag.length, text.length - endTag.length);
        editor.edit(editBuilder => {
            editBuilder.replace(selection, unwrap);
        });
    } else {
        const replacement = `${startTag}${text}${endTag}`;
        editor.edit(editBuilder => {
            editBuilder.replace(selection, replacement);
        });
    }
}

export function insertTable() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return; }

    const tableSnippet = `
| Header 1 | Header 2 | Header 3 |
| :--- | :---: | ---: |
| Row 1 | Data | Data |
| Row 2 | Data | Data |
`;
    editor.insertSnippet(new vscode.SnippetString(tableSnippet));
}

export async function insertImage() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return; }

    const uris = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: {
            'Images': ['png', 'jpg', 'jpeg', 'gif', 'svg']
        }
    });

    if (uris && uris.length > 0) {
        const sourceUri = uris[0];

        let currentDir = '';
        if (editor.document.uri.scheme === 'file') {
            currentDir = path.dirname(editor.document.uri.fsPath);
        } else {
            const notebookEditor = vscode.window.visibleNotebookEditors.find(ne => ne.notebook.uri.toString() === editor.document.uri.toString());
            if (notebookEditor) {
                currentDir = path.dirname(notebookEditor.notebook.uri.fsPath);
            } else {
                if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
                    currentDir = vscode.workspace.workspaceFolders[0].uri.fsPath;
                } else {
                    vscode.window.showErrorMessage("Could not determine notebook directory for assets.");
                    return;
                }
            }
        }

        const assetsDir = path.join(currentDir, 'assets');

        if (!fs.existsSync(assetsDir)) {
            fs.mkdirSync(assetsDir);
        }

        const fileName = path.basename(sourceUri.fsPath);
        const destPath = path.join(assetsDir, fileName);

        try {
            fs.copyFileSync(sourceUri.fsPath, destPath);
        } catch (e) {
            vscode.window.showErrorMessage(`Failed to copy image: ${e}`);
            return;
        }

        const relativePath = `assets/${fileName}`;
        const imageHtml = `<img src="${relativePath}" alt="${fileName}" width="500" />`;

        editor.edit(editBuilder => {
            editBuilder.insert(editor.selection.active, imageHtml);
        });
    }
}

export function toggleList(type: 'bullet' | 'numbered') {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return; }

    const selection = editor.selection;
    const document = editor.document;

    const startLine = selection.start.line;
    const endLine = selection.end.line;

    let replacement = '';

    for (let i = startLine; i <= endLine; i++) {
        const lineText = document.lineAt(i).text;

        const isBullet = lineText.trim().startsWith('- ');
        const isNumbered = /^\s*\d+\.\s/.test(lineText);

        let newLine = lineText;

        if (type === 'bullet') {
            if (isBullet) {
                newLine = lineText.replace(/^\s*-\s/, '');
            } else if (isNumbered) {
                newLine = lineText.replace(/^\s*\d+\.\s/, '- ');
            } else {
                newLine = `- ${lineText}`;
            }
        } else {
            if (isNumbered) {
                newLine = lineText.replace(/^\s*\d+\.\s/, '');
            } else if (isBullet) {
                const num = i - startLine + 1;
                newLine = lineText.replace(/^\s*-\s/, `${num}. `);
            } else {
                const num = i - startLine + 1;
                newLine = `${num}. ${lineText}`;
            }
        }

        replacement += newLine + (i < endLine ? '\n' : '');
    }

    const range = new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).text.length);
    editor.edit(editBuilder => {
        editBuilder.replace(range, replacement);
    });
}
