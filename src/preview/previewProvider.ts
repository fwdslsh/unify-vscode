import * as vscode from 'vscode';
import * as path from 'path';
import { UnifyRenderer } from '../integration/unifyRenderer';
import { ConfigLoader } from '../integration/configLoader';
import { ExtensionContext } from '../types';

export class UnifyPreviewProvider implements vscode.WebviewPanelSerializer {
    private panels = new Map<string, vscode.WebviewPanel>();
    private renderer: UnifyRenderer;
    private configLoader: ConfigLoader;
    private context: ExtensionContext;
    private updateTimeout: NodeJS.Timeout | undefined;

    constructor(context: ExtensionContext) {
        this.context = context;
        
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        this.configLoader = new ConfigLoader(workspaceRoot);
        this.renderer = new UnifyRenderer(workspaceRoot);

        // Initialize configuration
        this.initializeConfig();

        // Register serializer for webview persistence
        context.extensionContext.subscriptions.push(
            vscode.window.registerWebviewPanelSerializer('unify.preview', this)
        );

        // Set up document change listener
        this.setupDocumentWatcher();
    }

    private async initializeConfig() {
        const config = await this.configLoader.loadConfig();
        this.renderer.updateConfig(config);

        // Watch for config changes
        const configWatcher = await this.configLoader.watchConfigChanges((newConfig) => {
            this.renderer.updateConfig(newConfig);
            this.refreshAllPanels();
        });

        this.context.extensionContext.subscriptions.push(configWatcher);
    }

    private setupDocumentWatcher() {
        // Debounced document change handler
        const onDocumentChange = (document: vscode.TextDocument) => {
            if (document.languageId !== 'html') {
                return;
            }

            // Clear existing timeout
            if (this.updateTimeout) {
                clearTimeout(this.updateTimeout);
            }

            // Get debounce delay from settings
            const config = vscode.workspace.getConfiguration('unify');
            const debounceDelay = config.get<number>('preview.debounceDelay', 200);

            // Set new timeout
            this.updateTimeout = setTimeout(() => {
                this.updatePreviewForDocument(document);
            }, debounceDelay);
        };

        // Register document change listeners
        this.context.extensionContext.subscriptions.push(
            vscode.workspace.onDidChangeTextDocument(e => {
                const config = vscode.workspace.getConfiguration('unify');
                if (config.get<boolean>('preview.autoRefresh', true)) {
                    onDocumentChange(e.document);
                }
            }),
            vscode.workspace.onDidSaveTextDocument(document => {
                onDocumentChange(document);
            })
        );
    }

    async showPreview(document: vscode.TextDocument): Promise<void> {
        const panel = await this.getOrCreatePanel(document, vscode.ViewColumn.Active);
        panel.reveal();
    }

    async showPreviewToSide(document: vscode.TextDocument): Promise<void> {
        const config = vscode.workspace.getConfiguration('unify');
        const openToSide = config.get<boolean>('preview.openToSide', true);
        
        const viewColumn = openToSide ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active;
        const panel = await this.getOrCreatePanel(document, viewColumn);
        panel.reveal();
    }

    private async getOrCreatePanel(
        document: vscode.TextDocument,
        viewColumn: vscode.ViewColumn
    ): Promise<vscode.WebviewPanel> {
        const key = document.uri.toString();
        let panel = this.panels.get(key);

        if (panel) {
            return panel;
        }

        // Create new panel
        const fileName = path.basename(document.fileName);
        panel = vscode.window.createWebviewPanel(
            'unify.preview',
            `Preview: ${fileName}`,
            viewColumn,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.file(path.dirname(document.fileName)),
                    vscode.Uri.file(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '')
                ]
            }
        );

        // Set icon
        panel.iconPath = {
            light: vscode.Uri.file(path.join(this.context.extensionContext.extensionPath, 'resources', 'light', 'preview.svg')),
            dark: vscode.Uri.file(path.join(this.context.extensionContext.extensionPath, 'resources', 'dark', 'preview.svg'))
        };

        // Handle panel disposal
        panel.onDidDispose(() => {
            this.panels.delete(key);
        });

        // Handle panel visibility changes
        panel.onDidChangeViewState(() => {
            if (panel!.visible) {
                this.updatePanel(panel!, document);
            }
        });

        this.panels.set(key, panel);
        await this.updatePanel(panel, document);

        return panel;
    }

    private async updatePanel(panel: vscode.WebviewPanel, document: vscode.TextDocument) {
        try {
            const result = await this.renderer.renderDocument(document);
            
            // Update diagnostics
            this.context.diagnostics.set(document.uri, result.diagnostics);

            // Generate webview HTML
            const webviewHtml = this.generateWebviewHtml(panel.webview, result.html, document);
            panel.webview.html = webviewHtml;

            this.context.outputChannel.appendLine(`Preview updated for ${document.fileName}`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.context.outputChannel.appendLine(`Preview update failed: ${errorMessage}`);
            
            panel.webview.html = this.generateErrorHtml(errorMessage);
        }
    }

    private generateWebviewHtml(webview: vscode.Webview, content: string, document: vscode.TextDocument): string {
        // Generate nonce for security
        const nonce = this.getNonce();

        // Get workspace URI for resource loading
        const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;
        const baseUri = workspaceUri ? webview.asWebviewUri(workspaceUri) : '';

        // Inject CSS and scripts for styling and functionality
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionContext.extensionUri, 'media', 'preview.css')
        );

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; 
        img-src ${webview.cspSource} https: data:; 
        style-src ${webview.cspSource} 'unsafe-inline'; 
        script-src 'nonce-${nonce}';
        font-src ${webview.cspSource} https:;">
    <base href="${baseUri}/">
    <link href="${styleUri}" rel="stylesheet">
    <title>Unify Preview</title>
    <style nonce="${nonce}">
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            margin: 0;
            padding: 20px;
            line-height: 1.6;
        }
        
        .preview-container {
            max-width: 100%;
            margin: 0 auto;
        }
        
        .preview-header {
            background-color: var(--vscode-panel-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            padding: 10px 15px;
            margin-bottom: 20px;
            font-size: 0.9em;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .preview-content {
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            background-color: white;
            color: black;
            overflow: auto;
        }
        
        .preview-content iframe {
            width: 100%;
            border: none;
            min-height: 500px;
        }
        
        .error-message {
            color: var(--vscode-errorForeground);
            background-color: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
            border-radius: 4px;
            padding: 15px;
            margin: 20px 0;
        }

        .refresh-button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 3px;
            padding: 6px 12px;
            cursor: pointer;
            font-size: 0.9em;
        }

        .refresh-button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
    </style>
</head>
<body>
    <div class="preview-container">
        <div class="preview-header">
            <span>Preview: ${path.basename(document.fileName)}</span>
            <button class="refresh-button" onclick="refreshPreview()" nonce="${nonce}">Refresh</button>
        </div>
        <div class="preview-content">
            ${content}
        </div>
    </div>
    
    <script nonce="${nonce}">
        function refreshPreview() {
            const vscode = acquireVsCodeApi();
            vscode.postMessage({ command: 'refresh' });
        }
        
        // Handle navigation clicks within preview
        document.addEventListener('click', (e) => {
            const target = e.target;
            if (target.tagName === 'A' && target.href) {
                e.preventDefault();
                const vscode = acquireVsCodeApi();
                vscode.postMessage({ 
                    command: 'navigate', 
                    href: target.href 
                });
            }
        });

        // Auto-scroll to maintain position
        let scrollPosition = 0;
        window.addEventListener('scroll', () => {
            scrollPosition = window.scrollY;
        });

        // Restore scroll position after updates
        window.addEventListener('load', () => {
            if (scrollPosition > 0) {
                window.scrollTo(0, scrollPosition);
            }
        });
    </script>
</body>
</html>`;
    }

    private generateErrorHtml(error: string): string {
        const nonce = this.getNonce();
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <title>Unify Preview Error</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            margin: 0;
            padding: 20px;
        }
        .error {
            color: var(--vscode-errorForeground);
            background-color: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
            border-radius: 4px;
            padding: 20px;
        }
        pre {
            background-color: var(--vscode-textBlockQuote-background);
            padding: 10px;
            border-radius: 4px;
            overflow-x: auto;
        }
    </style>
</head>
<body>
    <div class="error">
        <h2>Preview Error</h2>
        <p>Failed to render Unify preview:</p>
        <pre>${this.escapeHtml(error)}</pre>
        <p>Check the VS Code Problems panel for more details.</p>
    </div>
</body>
</html>`;
    }

    private updatePreviewForDocument(document: vscode.TextDocument) {
        const key = document.uri.toString();
        const panel = this.panels.get(key);
        
        if (panel && panel.visible) {
            this.updatePanel(panel, document);
        }
    }

    refresh() {
        this.refreshAllPanels();
    }

    private refreshAllPanels() {
        for (const [uri, panel] of this.panels) {
            if (panel.visible) {
                const document = vscode.workspace.textDocuments.find(doc => 
                    doc.uri.toString() === uri
                );
                if (document) {
                    this.updatePanel(panel, document);
                }
            }
        }
    }

    private getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // WebviewPanelSerializer implementation
    async deserializeWebviewPanel(
        webviewPanel: vscode.WebviewPanel,
        state: any
    ): Promise<void> {
        // This method is called when VS Code restarts and restores webview panels
        
        if (state && state.documentUri) {
            const documentUri = vscode.Uri.parse(state.documentUri);
            const document = await vscode.workspace.openTextDocument(documentUri);
            
            this.panels.set(documentUri.toString(), webviewPanel);
            
            // Restore panel event handlers
            webviewPanel.onDidDispose(() => {
                this.panels.delete(documentUri.toString());
            });

            webviewPanel.onDidChangeViewState(() => {
                if (webviewPanel.visible) {
                    this.updatePanel(webviewPanel, document);
                }
            });

            // Update the panel content
            await this.updatePanel(webviewPanel, document);
        }
    }
}