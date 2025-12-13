import * as vscode from 'vscode';
import { TextDecoder, TextEncoder } from 'util';

interface RawNotebookCell {
    language: string;
    value: string;
    kind: vscode.NotebookCellKind;
    metadata?: { [key: string]: any };
}

interface RawNotebook {
    cells: RawNotebookCell[];
}

export class CBookSerializer implements vscode.NotebookSerializer {
    async deserializeNotebook(
        content: Uint8Array,
        _token: vscode.CancellationToken
    ): Promise<vscode.NotebookData> {
        const contents = new TextDecoder().decode(content);
        let raw: RawNotebook = { cells: [] };

        try {
            raw = <RawNotebook>JSON.parse(contents);
        } catch {
            raw = { cells: [] };
        }

        const cells = raw.cells.map(item => {
            const cell = new vscode.NotebookCellData(
                item.kind,
                item.value,
                item.language
            );
            cell.metadata = item.metadata;
            return cell;
        });

        return new vscode.NotebookData(cells);
    }

    async serializeNotebook(
        data: vscode.NotebookData,
        _token: vscode.CancellationToken
    ): Promise<Uint8Array> {
        const contents: RawNotebook = { cells: [] };

        for (const cell of data.cells) {
            contents.cells.push({
                kind: cell.kind,
                language: cell.languageId,
                value: cell.value,
                metadata: cell.metadata
            });
        }

        return new TextEncoder().encode(JSON.stringify(contents, null, 2));
    }
}
