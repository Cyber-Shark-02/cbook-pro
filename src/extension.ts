import * as vscode from 'vscode';
import { CBookSerializer } from './notebookSerializer';
import { CBookController } from './notebookKernel';
import * as markdownTools from './markdownTools';
import * as exportManager from './exportManager';
import { VariableExplorerProvider } from './variableExplorer';
import { KernelManagerProvider } from './kernelManager';

export function activate(context: vscode.ExtensionContext) {
    // Register Notebook Serializer
    context.subscriptions.push(
        vscode.workspace.registerNotebookSerializer('cbook-notebook', new CBookSerializer())
    );

    // Register Notebook Controller
    const controller = new CBookController();
    context.subscriptions.push(controller);

    // Register Markdown Tools
    context.subscriptions.push(
        vscode.commands.registerCommand('cbook.md.bold', () => markdownTools.toggleFormat('**', '**')),
        vscode.commands.registerCommand('cbook.md.italic', () => markdownTools.toggleFormat('*', '*')),
        vscode.commands.registerCommand('cbook.md.highlight', () => markdownTools.toggleFormat('<mark style="background-color: #ffeb3b; color: black;">', '</mark>')),
        vscode.commands.registerCommand('cbook.md.colorRed', () => markdownTools.toggleFormat('<span style="color: red;">', '</span>')),
        vscode.commands.registerCommand('cbook.md.insertTable', () => markdownTools.insertTable()),
        vscode.commands.registerCommand('cbook.md.insertImage', () => markdownTools.insertImage()),
        vscode.commands.registerCommand('cbook.md.bullet', () => markdownTools.toggleList('bullet')),
        vscode.commands.registerCommand('cbook.md.numbered', () => markdownTools.toggleList('numbered')),
        vscode.commands.registerCommand('cbook.toggleReadOnly', (cell: vscode.NotebookCell) => {
            if (cell) {
                const isReadOnly = cell.metadata.cbook_readonly;
                const edit = new vscode.WorkspaceEdit();
                const newMetadata = { ...cell.metadata, cbook_readonly: !isReadOnly };
                const nbEdit = vscode.NotebookEdit.updateCellMetadata(cell.index, newMetadata);
                edit.set(cell.notebook.uri, [nbEdit]);
                vscode.workspace.applyEdit(edit);
            }
        })
    );

    // Register Export Command
    context.subscriptions.push(
        vscode.commands.registerCommand('cbook.exportToHTML', () => exportManager.exportToHTML()),
        vscode.commands.registerCommand('cbook-pro.toggleStateless', (cell: vscode.NotebookCell) => {
            if (cell) {
                if (cell.document.languageId !== 'python') {
                    vscode.window.showWarningMessage('Stateless Mode is only available for Python cells.');
                    return;
                }
                const isStateless = cell.metadata.cbook_stateless;
                const edit = new vscode.WorkspaceEdit();
                const newMetadata = { ...cell.metadata, cbook_stateless: !isStateless };
                const nbEdit = vscode.NotebookEdit.updateCellMetadata(cell.index, newMetadata);
                edit.set(cell.notebook.uri, [nbEdit]);
                vscode.workspace.applyEdit(edit).then(success => {
                    if (success) {
                        vscode.window.showInformationMessage(`Stateless Mode: ${!isStateless ? 'ON' : 'OFF'}`);
                    }
                });
            }
        })
    );

    // Register Webview Providers
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('cbook.variableExplorer', new VariableExplorerProvider(context.extensionUri)),
        vscode.window.registerWebviewViewProvider('cbook.kernelManager', new KernelManagerProvider(context.extensionUri))
    );
}

export function deactivate() { }
