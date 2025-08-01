import * as vscode from 'vscode';
import { UnifyPreviewProvider } from './preview/previewProvider';
import { UnifyDefinitionProvider } from './providers/definitionProvider';
import { UnifyCompletionProvider } from './providers/completionProvider';
import { UnifyHoverProvider } from './providers/hoverProvider';
import { UnifyDiagnostics } from './diagnostics/diagnostics';
import { ExtensionContext } from './types';

let context: ExtensionContext;

export function activate(extensionContext: vscode.ExtensionContext) {
    console.log('Unify extension is being activated');

    // Initialize extension context
    context = {
        extensionContext,
        outputChannel: vscode.window.createOutputChannel('Unify'),
        diagnostics: vscode.languages.createDiagnosticCollection('unify'),
        previewProvider: undefined,
        isActive: false
    };

    // Check if this is a Unify workspace
    checkUnifyWorkspace().then(isActive => {
        context.isActive = isActive;
        vscode.commands.executeCommand('setContext', 'unify.isActive', isActive);
        
        if (isActive) {
            initializeUnifyFeatures();
        }
    });

    // Register commands
    registerCommands();

    // Watch for workspace changes
    const workspaceWatcher = vscode.workspace.onDidChangeWorkspaceFolders(() => {
        checkUnifyWorkspace().then(isActive => {
            context.isActive = isActive;
            vscode.commands.executeCommand('setContext', 'unify.isActive', isActive);
            
            if (isActive && !context.previewProvider) {
                initializeUnifyFeatures();
            }
        });
    });

    extensionContext.subscriptions.push(workspaceWatcher);

    context.outputChannel.appendLine('Unify extension activated');
}

async function checkUnifyWorkspace(): Promise<boolean> {
    if (!vscode.workspace.workspaceFolders) {
        return false;
    }

    // Check for Unify indicators
    const patterns = [
        '**/package.json',
        '**/unify.config.*',
        '**/src/**/*.html',
        '**/.components/**/*.html',
        '**/.layouts/**/*.html'
    ];

    for (const pattern of patterns) {
        const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**', 1);
        if (files.length > 0) {
            // Additional check for Unify specific content
            if (pattern.includes('package.json')) {
                try {
                    const content = await vscode.workspace.fs.readFile(files[0]);
                    const packageJson = JSON.parse(content.toString());
                    if (packageJson.dependencies?.['@fwdslsh/unify'] || 
                        packageJson.devDependencies?.['@fwdslsh/unify'] ||
                        packageJson.scripts?.build?.includes('unify') ||
                        packageJson.scripts?.serve?.includes('unify')) {
                        return true;
                    }
                }
                catch {
                    // Continue checking other indicators
                }
            } else {
                return true;
            }
        }
    }

    return false;
}

function initializeUnifyFeatures() {
    if (!context.extensionContext) {
        return;
    }

    context.outputChannel.appendLine('Initializing Unify features');

    // Initialize preview provider
    context.previewProvider = new UnifyPreviewProvider(context);

    // Initialize diagnostics
    const diagnostics = new UnifyDiagnostics(context);

    // Register language providers
    const definitionProvider = new UnifyDefinitionProvider(context);
    const completionProvider = new UnifyCompletionProvider(context);
    const hoverProvider = new UnifyHoverProvider(context);

    const subscriptions = [
        // Language providers
        vscode.languages.registerDefinitionProvider(
            { scheme: 'file', language: 'html' },
            definitionProvider
        ),
        vscode.languages.registerCompletionItemProvider(
            { scheme: 'file', language: 'html' },
            completionProvider,
            '"', '/', '.'
        ),
        vscode.languages.registerHoverProvider(
            { scheme: 'file', language: 'html' },
            hoverProvider
        ),

        // File watchers for live diagnostics
        vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.languageId === 'html') {
                diagnostics.updateDiagnostics(e.document);
            }
        }),
        vscode.workspace.onDidSaveTextDocument(document => {
            if (document.languageId === 'html') {
                diagnostics.updateDiagnostics(document);
                context.previewProvider?.refresh();
            }
        })
    ];

    context.extensionContext.subscriptions.push(...subscriptions);
}

function registerCommands() {
    if (!context.extensionContext) {
        return;
    }

    const commands = [
        vscode.commands.registerCommand('unify.openPreview', () => {
            if (!context.isActive) {
                vscode.window.showWarningMessage('Unify preview is only available in Unify projects');
                return;
            }
            
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active editor');
                return;
            }

            if (!context.previewProvider) {
                initializeUnifyFeatures();
            }

            context.previewProvider?.showPreview(editor.document);
        }),

        vscode.commands.registerCommand('unify.previewToSide', () => {
            if (!context.isActive) {
                vscode.window.showWarningMessage('Unify preview is only available in Unify projects');
                return;
            }

            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active editor');
                return;
            }

            if (!context.previewProvider) {
                initializeUnifyFeatures();
            }

            context.previewProvider?.showPreviewToSide(editor.document);
        }),

        vscode.commands.registerCommand('unify.refreshPreview', () => {
            if (context.previewProvider) {
                context.previewProvider.refresh();
            }
        })
    ];

    context.extensionContext.subscriptions.push(...commands);
}

export function deactivate() {
    if (context?.diagnostics) {
        context.diagnostics.clear();
    }
    if (context?.outputChannel) {
        context.outputChannel.dispose();
    }
}