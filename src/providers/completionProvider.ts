import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ExtensionContext, CompletionContext } from '../types';

export class UnifyCompletionProvider implements vscode.CompletionItemProvider {
    private context: ExtensionContext;

    constructor(context: ExtensionContext) {
        this.context = context;
    }

    async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        completionContext: vscode.CompletionContext
    ): Promise<vscode.CompletionItem[] | vscode.CompletionList | undefined> {
        const line = document.lineAt(position);
        const lineText = line.text.substring(0, position.character);

        // Check context and provide appropriate completions
        const context = this.getCompletionContext(lineText, position);
        
        if (!context) {
            return undefined;
        }

        switch (context.type) {
            case 'include-path':
                return this.provideIncludePathCompletions(document, context);
            case 'slot-name':
                return this.provideSlotNameCompletions(document, context);
            case 'template-extends':
                return this.provideTemplateExtendsCompletions(document, context);
            default:
                return undefined;
        }
    }

    private getCompletionContext(lineText: string, position: vscode.Position): CompletionContext | undefined {
        // Check for include directive completion
        const includeMatch = lineText.match(/<!--#include\s+(virtual|file)=\"([^\"]*?)$/);
        if (includeMatch) {
            return {
                type: 'include-path',
                prefix: includeMatch[2],
                range: new vscode.Range(
                    position.line,
                    position.character - includeMatch[2].length,
                    position.line,
                    position.character
                )
            };
        }

        // Check for template extends completion
        const extendsMatch = lineText.match(/<template[^>]*extends=\"([^\"]*?)$/);
        if (extendsMatch) {
            return {
                type: 'template-extends',
                prefix: extendsMatch[1],
                range: new vscode.Range(
                    position.line,
                    position.character - extendsMatch[1].length,
                    position.line,
                    position.character
                )
            };
        }

        // Check for slot name completion
        const slotMatch = lineText.match(/<slot[^>]*name=\"([^\"]*?)$/);
        if (slotMatch) {
            return {
                type: 'slot-name',
                prefix: slotMatch[1],
                range: new vscode.Range(
                    position.line,
                    position.character - slotMatch[1].length,
                    position.line,
                    position.character
                )
            };
        }

        return undefined;
    }

    private async provideIncludePathCompletions(
        document: vscode.TextDocument,
        context: CompletionContext
    ): Promise<vscode.CompletionItem[]> {
        const workspaceRoot = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath;
        if (!workspaceRoot) {
            return [];
        }

        const config = vscode.workspace.getConfiguration('unify');
        const sourceDir = config.get<string>('sourceDirectory', 'src');
        const includesDir = config.get<string>('includesDirectory', 'includes');

        const completions: vscode.CompletionItem[] = [];

        // Determine if this is a virtual or file include
        const line = document.lineAt(context.range.start.line);
        const isVirtual = line.text.includes('virtual=');

        let basePath: string;
        if (isVirtual) {
            // Virtual includes are relative to source root
            basePath = path.join(workspaceRoot, sourceDir);
        } else {
            // File includes are relative to current file
            basePath = path.dirname(document.fileName);
        }

        // Get directory to search in based on current prefix
        const prefixDir = path.dirname(context.prefix);
        const searchDir = prefixDir === '.' ? basePath : path.join(basePath, prefixDir);
        const prefix = path.basename(context.prefix);

        if (fs.existsSync(searchDir)) {
            const entries = fs.readdirSync(searchDir, { withFileTypes: true });

            for (const entry of entries) {
                if (entry.name.startsWith('.')) {
                    continue; // Skip hidden files
                }

                if (entry.name.toLowerCase().startsWith(prefix.toLowerCase())) {
                    const item = new vscode.CompletionItem(
                        entry.name,
                        entry.isDirectory() ? vscode.CompletionItemKind.Folder : vscode.CompletionItemKind.File
                    );

                    // Set the text to insert
                    const insertText = prefixDir === '.' ? entry.name : `${prefixDir}/${entry.name}`;
                    item.insertText = insertText;

                    // Add detail and documentation
                    if (entry.isDirectory()) {
                        item.detail = 'Directory';
                        item.insertText += '/';
                        item.command = {
                            command: 'editor.action.triggerSuggest',
                            title: 'Trigger Suggest'
                        };
                    } else {
                        item.detail = this.getFileTypeDetail(entry.name);
                        
                        // Try to read first few lines for documentation
                        try {
                            const filePath = path.join(searchDir, entry.name);
                            const content = fs.readFileSync(filePath, 'utf-8');
                            const preview = content.substring(0, 200).replace(/\n/g, ' ').trim();
                            if (preview) {
                                item.documentation = new vscode.MarkdownString(`\`\`\`html\n${preview}...\n\`\`\``);
                            }
                        } catch {
                            // Ignore read errors
                        }
                    }

                    // Set sort order
                    item.sortText = entry.isDirectory() ? `0_${entry.name}` : `1_${entry.name}`;

                    completions.push(item);
                }
            }
        }

        // Add common directories for virtual includes
        if (isVirtual && context.prefix === '') {
            const commonDirs = [includesDir, 'components', 'layouts', 'partials'];
            for (const dir of commonDirs) {
                const dirPath = path.join(basePath, dir);
                if (fs.existsSync(dirPath)) {
                    const item = new vscode.CompletionItem(dir, vscode.CompletionItemKind.Folder);
                    item.insertText = `${dir}/`;
                    item.detail = 'Common directory';
                    item.sortText = `0_${dir}`;
                    item.command = {
                        command: 'editor.action.triggerSuggest',
                        title: 'Trigger Suggest'
                    };
                    completions.push(item);
                }
            }
        }

        return completions;
    }

    private async provideSlotNameCompletions(
        document: vscode.TextDocument,
        context: CompletionContext
    ): Promise<vscode.CompletionItem[]> {
        const completions: vscode.CompletionItem[] = [];

        // Find slots defined in extended templates
        const extendedTemplate = await this.findExtendedTemplate(document);
        if (extendedTemplate) {
            const templateDoc = await vscode.workspace.openTextDocument(vscode.Uri.file(extendedTemplate));
            const templateSlots = this.extractSlotsFromDocument(templateDoc);
            
            for (const slot of templateSlots) {
                if (slot.startsWith(context.prefix)) {
                    const item = new vscode.CompletionItem(slot, vscode.CompletionItemKind.Property);
                    item.detail = 'Template slot';
                    item.documentation = `Slot defined in ${path.basename(extendedTemplate)}`;
                    completions.push(item);
                }
            }
        }

        // Add common slot names
        const commonSlots = ['content', 'title', 'header', 'footer', 'sidebar', 'main', 'navigation'];
        for (const slot of commonSlots) {
            if (slot.startsWith(context.prefix) && !completions.some(c => c.label === slot)) {
                const item = new vscode.CompletionItem(slot, vscode.CompletionItemKind.Keyword);
                item.detail = 'Common slot name';
                item.sortText = `1_${slot}`;
                completions.push(item);
            }
        }

        return completions;
    }

    private async provideTemplateExtendsCompletions(
        document: vscode.TextDocument,
        context: CompletionContext
    ): Promise<vscode.CompletionItem[]> {
        const workspaceRoot = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath;
        if (!workspaceRoot) {
            return [];
        }

        const config = vscode.workspace.getConfiguration('unify');
        const sourceDir = config.get<string>('sourceDirectory', 'src');

        const completions: vscode.CompletionItem[] = [];

        // Search in layouts directory
        const layoutsDir = path.join(workspaceRoot, sourceDir, 'layouts');
        if (fs.existsSync(layoutsDir)) {
            const layouts = fs.readdirSync(layoutsDir)
                .filter(file => file.endsWith('.html') && file.startsWith(context.prefix))
                .map(file => {
                    const item = new vscode.CompletionItem(file, vscode.CompletionItemKind.File);
                    item.detail = 'Layout template';
                    item.insertText = file;
                    
                    // Try to extract title or description from file
                    try {
                        const filePath = path.join(layoutsDir, file);
                        const content = fs.readFileSync(filePath, 'utf-8');
                        const titleMatch = content.match(/<title>([^<]+)<\/title>/i);
                        if (titleMatch) {
                            item.documentation = `Title: ${titleMatch[1]}`;
                        }
                    } catch {
                        // Ignore read errors
                    }

                    return item;
                });

            completions.push(...layouts);
        }

        // Search in components directory
        const componentsDir = path.join(workspaceRoot, sourceDir, 'components');
        if (fs.existsSync(componentsDir)) {
            const components = fs.readdirSync(componentsDir)
                .filter(file => file.endsWith('.html') && file.startsWith(context.prefix))
                .map(file => {
                    const item = new vscode.CompletionItem(file, vscode.CompletionItemKind.File);
                    item.detail = 'Component template';
                    item.insertText = file;
                    return item;
                });

            completions.push(...components);
        }

        return completions;
    }

    private async findExtendedTemplate(document: vscode.TextDocument): Promise<string | undefined> {
        const text = document.getText();
        const templateMatch = text.match(/<template[^>]+extends=\"([^\"]+)\"/);
        
        if (templateMatch) {
            const extendsPath = templateMatch[1];
            const workspaceRoot = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath;
            if (!workspaceRoot) {
                return undefined;
            }

            const config = vscode.workspace.getConfiguration('unify');
            const sourceDir = config.get<string>('sourceDirectory', 'src');

            // Try different possible locations
            const possiblePaths = [
                path.join(workspaceRoot, sourceDir, 'layouts', extendsPath),
                path.join(workspaceRoot, sourceDir, 'components', extendsPath),
                path.join(workspaceRoot, sourceDir, extendsPath)
            ];

            for (const possiblePath of possiblePaths) {
                if (fs.existsSync(possiblePath)) {
                    return possiblePath;
                }
            }
        }

        return undefined;
    }

    private extractSlotsFromDocument(document: vscode.TextDocument): string[] {
        const text = document.getText();
        const slotRegex = /<slot[^>]+name=\"([^\"]+)\"/g;
        const slots: string[] = [];
        let match;

        while ((match = slotRegex.exec(text)) !== null) {
            slots.push(match[1]);
        }

        return [...new Set(slots)]; // Remove duplicates
    }

    private getFileTypeDetail(fileName: string): string {
        const ext = path.extname(fileName).toLowerCase();
        switch (ext) {
            case '.html':
            case '.htm':
                return 'HTML file';
            case '.md':
                return 'Markdown file';
            case '.css':
                return 'CSS file';
            case '.js':
                return 'JavaScript file';
            case '.ts':
                return 'TypeScript file';
            case '.json':
                return 'JSON file';
            default:
                return 'File';
        }
    }
}