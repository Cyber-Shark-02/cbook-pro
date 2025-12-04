import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export function toggleFormat(startTag: string, endTag: string) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return; }

    const selection = editor.selection;
    const text = editor.document.getText(selection);

    // Smart Toggle Logic
    // Check if the text is already wrapped with the tags
    if (text.startsWith(startTag) && text.endsWith(endTag)) {
        // Unwrap
        const unwrap = text.substring(startTag.length, text.length - endTag.length);
        editor.edit(editBuilder => {
            editBuilder.replace(selection, unwrap);
        });
    } else {
        // Check if the selection is inside a larger block that is wrapped? 
        // That's complex. Let's stick to the requested "make it good" which implies basic toggle works.
        // But let's also handle the case where the user selects *inside* the tags.
        // For now, strict wrapping check is a huge improvement over "always wrap".

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

        // Robustly find the notebook directory
        let currentDir = '';
        if (editor.document.uri.scheme === 'file') {
            currentDir = path.dirname(editor.document.uri.fsPath);
        } else {
            // If cell is virtual, try to find the notebook from visible editors
            const notebookEditor = vscode.window.visibleNotebookEditors.find(ne => ne.notebook.uri.toString() === editor.document.uri.toString());
            if (notebookEditor) {
                currentDir = path.dirname(notebookEditor.notebook.uri.fsPath);
            } else {
                // Fallback to workspace root or error
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

        // Copy file
        try {
            fs.copyFileSync(sourceUri.fsPath, destPath);
        } catch (e) {
            vscode.window.showErrorMessage(`Failed to copy image: ${e}`);
            return;
        }

        const relativePath = `assets/${fileName}`;

        // Use HTML for resizing support
        // Default width 500px to be "good" size
        const imageHtml = `<img src="${relativePath}" alt="${fileName}" width="500" />`;

        editor.edit(editBuilder => {
            editBuilder.insert(editor.selection.active, imageHtml);
        });
    }
}
