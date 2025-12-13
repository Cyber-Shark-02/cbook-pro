// @ts-nocheck
import type { ActivationFunction } from 'vscode-notebook-renderer';

export const activate: ActivationFunction = (context) => {
    return {
        renderOutputItem(data, element) {
            try {
                const json = data.json();

                if (json.status === 'submitted') {
                    element.innerHTML = `<div style="font-family: var(--vscode-editor-font-family); white-space: pre-wrap;"><span style="font-weight: bold;">${escapeHtml(json.prompt)}</span><span>${escapeHtml(json.value)}</span></div>`;
                    return;
                }

                // Interactive Input Mode
                element.innerHTML = `
                    <div style="font-family: var(--vscode-editor-font-family); display: flex; align-items: center;">
                        <span style="white-space: pre; font-weight: bold;">${escapeHtml(json.prompt || '')}</span>
                        <input type="text" style="
                            flex: 1; 
                            background: var(--vscode-input-background); 
                            color: var(--vscode-input-foreground); 
                            border: 1px solid var(--vscode-input-border); 
                            padding: 2px 4px;
                            outline: none;
                        " />
                    </div>
                `;

                const input = element.querySelector('input') as HTMLInputElement;

                if (input) {
                    setTimeout(() => input.focus(), 100);

                    input.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') {
                            const value = input.value;
                            input.disabled = true;

                            if (!context.postMessage) {
                                element.innerHTML = `<div style="color: red; font-weight: bold;">Error: Renderer context missing postMessage!</div>`;
                                throw new Error('Renderer context missing postMessage');
                            }

                            context.postMessage({
                                type: 'cbook-input-response',
                                value: value,
                                requestId: json.requestId
                            });

                            // Optimistic update
                            element.innerHTML = `<div style="font-family: var(--vscode-editor-font-family); white-space: pre-wrap;"><span style="font-weight: bold;">${escapeHtml(json.prompt)}</span><span>${escapeHtml(value)}</span></div>`;
                        }
                    });
                }
            } catch (err) {
                element.innerHTML = `<div style="color: red; font-weight: bold;">Renderer Error: ${err}</div>`;
            }
        }
    };
};

function escapeHtml(unsafe: string): string {
    if (!unsafe) return "";
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
