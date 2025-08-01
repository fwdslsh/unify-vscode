import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ExtensionContext } from '../types';

export class UnifyHoverProvider implements vscode.HoverProvider {
    private context: ExtensionContext;

    constructor(context: ExtensionContext) {
        this.context = context;
    }

    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Hover | undefined> {
        const line = document.lineAt(position);
        const lineText = line.text;

        // Check for include directives
        const includeInfo = this.findIncludeAtPosition(lineText, position.character);
        if (includeInfo) {
            return this.createIncludeHover(document, includeInfo, position);
        }

        // Check for template extends
        const templateInfo = this.findTemplateExtendsAtPosition(lineText, position.character);
        if (templateInfo) {
            return this.createTemplateHover(document, templateInfo, position);
        }

        // Check for slot elements
        const slotInfo = this.findSlotAtPosition(lineText, position.character);
        if (slotInfo) {
            return this.createSlotHover(document, slotInfo, position);
        }

        return undefined;
    }

    private findIncludeAtPosition(lineText: string, character: number): { type: string; path: string } | undefined {
        const includeRegex = /<!--#include\s+(virtual|file)=\"([^\"]+)\"\s*-->/g;
        let match;

        while ((match = includeRegex.exec(lineText)) !== null) {
            const [fullMatch, type, includePath] = match;
            const startPos = match.index;
            const endPos = startPos + fullMatch.length;

            if (character >= startPos && character <= endPos) {
                return { type, path: includePath };
            }
        }

        return undefined;
    }

    private findTemplateExtendsAtPosition(lineText: string, character: number): string | undefined {
        const templateRegex = /<template[^>]+extends=[\"']([^\"']+)[\"'][^>]*>/g;
        let match;

        while ((match = templateRegex.exec(lineText)) !== null) {
            const [fullMatch, extendsPath] = match;
            const startPos = match.index;
            const endPos = startPos + fullMatch.length;

            if (character >= startPos && character <= endPos) {
                return extendsPath;
            }
        }

        return undefined;
    }

    private findSlotAtPosition(lineText: string, character: number): string | undefined {
        const slotRegex = /<slot[^>]+name=[\"']([^\"']+)[\"'][^>]*>/g;
        let match;

        while ((match = slotRegex.exec(lineText)) !== null) {
            const [fullMatch, slotName] = match;
            const startPos = match.index;
            const endPos = startPos + fullMatch.length;

            if (character >= startPos && character <= endPos) {
                return slotName;
            }
        }

        return undefined;
    }

    private async createIncludeHover(
        document: vscode.TextDocument,
        includeInfo: { type: string; path: string },
        position: vscode.Position
    ): Promise<vscode.Hover | undefined> {
        const workspaceRoot = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath;
        if (!workspaceRoot) {
            return undefined;
        }

        let resolvedPath: string;
        let statusIcon: string;
        let statusText: string;

        // Resolve the path
        if (includeInfo.type === 'virtual') {
            const config = vscode.workspace.getConfiguration('unify');
            const sourceDir = config.get<string>('sourceDirectory', 'src');
            resolvedPath = path.join(workspaceRoot, sourceDir, includeInfo.path);
        } else {
            resolvedPath = path.resolve(path.dirname(document.fileName), includeInfo.path);
        }

        // Check if file exists
        let exists = fs.existsSync(resolvedPath);
        if (!exists) {
            // Try with common extensions
            const extensions = ['.html', '.htm', '.md'];
            for (const ext of extensions) {
                const pathWithExt = resolvedPath + ext;
                if (fs.existsSync(pathWithExt)) {
                    resolvedPath = pathWithExt;
                    exists = true;
                    break;
                }
            }
        }

        if (exists) {
            statusIcon = '✅';
            statusText = 'File exists';
        } else {
            statusIcon = '❌';
            statusText = 'File not found';
        }

        const markdown = new vscode.MarkdownString();
        markdown.isTrusted = true;

        // Header
        markdown.appendMarkdown(`### ${statusIcon} Unify Include\n\n`);

        // Include info
        markdown.appendMarkdown(`**Type:** \`${includeInfo.type}\`\n\n`);
        markdown.appendMarkdown(`**Path:** \`${includeInfo.path}\`\n\n`);
        markdown.appendMarkdown(`**Resolved:** \`${path.relative(workspaceRoot, resolvedPath)}\`\n\n`);
        markdown.appendMarkdown(`**Status:** ${statusText}\n\n`);

        // File preview if exists
        if (exists) {
            try {
                const stats = fs.statSync(resolvedPath);
                const fileSize = this.formatFileSize(stats.size);
                markdown.appendMarkdown(`**Size:** ${fileSize}\n\n`);

                // Read first few lines for preview
                const content = fs.readFileSync(resolvedPath, 'utf-8');
                const lines = content.split('\n').slice(0, 10);
                const preview = lines.join('\n');
                
                const extension = path.extname(resolvedPath).substring(1) || 'html';
                markdown.appendMarkdown(`**Preview:**\n\`\`\`${extension}\n${preview}\n\`\`\`\n`);

                // Commands
                markdown.appendMarkdown(`---\n\n`);
                markdown.appendMarkdown(`[Open File](command:vscode.open?${encodeURIComponent(JSON.stringify([vscode.Uri.file(resolvedPath)]))})\n`);
            } catch (error) {
                markdown.appendMarkdown(`**Error:** Unable to read file\n`);
            }
        } else {
            markdown.appendMarkdown(`**Suggestion:** Check the file path or create the missing file.\n\n`);
            
            // Offer to create file
            const dir = path.dirname(resolvedPath);
            if (fs.existsSync(dir)) {
                markdown.appendMarkdown(`[Create File](command:unify.createIncludeFile?${encodeURIComponent(JSON.stringify([resolvedPath]))})\n`);
            }
        }

        const range = new vscode.Range(position, position);
        return new vscode.Hover(markdown, range);
    }

    private async createTemplateHover(
        document: vscode.TextDocument,
        extendsPath: string,
        position: vscode.Position
    ): Promise<vscode.Hover | undefined> {
        const workspaceRoot = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath;
        if (!workspaceRoot) {
            return undefined;
        }

        const config = vscode.workspace.getConfiguration('unify');
        const sourceDir = config.get<string>('sourceDirectory', 'src');

        // Try to resolve template path
        const possiblePaths = [
            path.join(workspaceRoot, sourceDir, 'layouts', extendsPath),
            path.join(workspaceRoot, sourceDir, 'components', extendsPath),
            path.join(workspaceRoot, sourceDir, extendsPath)
        ];

        let resolvedPath: string | undefined;
        let exists = false;

        for (const possiblePath of possiblePaths) {
            let testPath = possiblePath;
            if (!path.extname(testPath)) {
                testPath += '.html';
            }

            if (fs.existsSync(testPath)) {
                resolvedPath = testPath;
                exists = true;
                break;
            }
        }

        const markdown = new vscode.MarkdownString();
        markdown.isTrusted = true;

        const statusIcon = exists ? '✅' : '❌';
        const statusText = exists ? 'Template found' : 'Template not found';

        markdown.appendMarkdown(`### ${statusIcon} Unify Template Extension\n\n`);
        markdown.appendMarkdown(`**Extends:** \`${extendsPath}\`\n\n`);
        
        if (resolvedPath) {
            markdown.appendMarkdown(`**Resolved:** \`${path.relative(workspaceRoot, resolvedPath)}\`\n\n`);
        }
        
        markdown.appendMarkdown(`**Status:** ${statusText}\n\n`);

        if (exists && resolvedPath) {
            // Extract slots from template
            try {
                const content = fs.readFileSync(resolvedPath, 'utf-8');
                const slots = this.extractSlots(content);
                
                if (slots.length > 0) {
                    markdown.appendMarkdown(`**Available Slots:**\n`);
                    for (const slot of slots) {
                        markdown.appendMarkdown(`- \`${slot}\`\n`);
                    }
                    markdown.appendMarkdown(`\n`);
                }

                // Template preview
                const lines = content.split('\n').slice(0, 8);
                const preview = lines.join('\n');
                markdown.appendMarkdown(`**Preview:**\n\`\`\`html\n${preview}\n\`\`\`\n`);

                markdown.appendMarkdown(`---\n\n`);
                markdown.appendMarkdown(`[Open Template](command:vscode.open?${encodeURIComponent(JSON.stringify([vscode.Uri.file(resolvedPath)]))})\n`);
            } catch (error) {
                markdown.appendMarkdown(`**Error:** Unable to read template file\n`);
            }
        }

        const range = new vscode.Range(position, position);
        return new vscode.Hover(markdown, range);
    }

    private async createSlotHover(
        document: vscode.TextDocument,
        slotName: string,
        position: vscode.Position
    ): Promise<vscode.Hover | undefined> {
        const markdown = new vscode.MarkdownString();
        markdown.isTrusted = true;

        markdown.appendMarkdown(`### 🎯 Unify Slot\n\n`);
        markdown.appendMarkdown(`**Name:** \`${slotName}\`\n\n`);

        // Find slot usage in current document
        const slotUsages = this.findSlotUsages(document, slotName);
        if (slotUsages.length > 0) {
            markdown.appendMarkdown(`**Found ${slotUsages.length} usage(s) in this document**\n\n`);
        }

        // Check if this slot is defined in extended template
        const extendedTemplate = await this.findExtendedTemplate(document);
        if (extendedTemplate) {
            try {
                const templateDoc = await vscode.workspace.openTextDocument(vscode.Uri.file(extendedTemplate));
                const templateSlots = this.extractSlots(templateDoc.getText());
                
                if (templateSlots.includes(slotName)) {
                    markdown.appendMarkdown(`**✅ Defined in:** \`${path.basename(extendedTemplate)}\`\n\n`);
                } else {
                    markdown.appendMarkdown(`**⚠️ Not defined in extended template**\n\n`);
                }

                markdown.appendMarkdown(`[Open Template](command:vscode.open?${encodeURIComponent(JSON.stringify([vscode.Uri.file(extendedTemplate)]))})\n`);
            } catch (error) {
                markdown.appendMarkdown(`**Error:** Unable to read extended template\n`);
            }
        }

        const range = new vscode.Range(position, position);
        return new vscode.Hover(markdown, range);
    }

    private extractSlots(content: string): string[] {
        const slotRegex = /<slot[^>]+name=[\"']([^\"']+)[\"'][^>]*>/g;
        const slots: string[] = [];
        let match;

        while ((match = slotRegex.exec(content)) !== null) {
            slots.push(match[1]);
        }

        return [...new Set(slots)]; // Remove duplicates
    }

    private findSlotUsages(document: vscode.TextDocument, slotName: string): vscode.Range[] {
        const text = document.getText();
        const lines = text.split('\n');
        const usages: vscode.Range[] = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const regex = new RegExp(`<slot[^>]+name=[\"']${slotName}[\"'][^>]*>`, 'g');
            let match;

            while ((match = regex.exec(line)) !== null) {
                const start = new vscode.Position(i, match.index);
                const end = new vscode.Position(i, match.index + match[0].length);
                usages.push(new vscode.Range(start, end));
            }
        }

        return usages;
    }

    private async findExtendedTemplate(document: vscode.TextDocument): Promise<string | undefined> {
        const text = document.getText();
        const templateMatch = text.match(/<template[^>]+extends=[\"']([^\"']+)[\"'][^>]*>/);
        
        if (templateMatch) {
            const extendsPath = templateMatch[1];
            const workspaceRoot = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath;
            if (!workspaceRoot) {
                return undefined;
            }

            const config = vscode.workspace.getConfiguration('unify');
            const sourceDir = config.get<string>('sourceDirectory', 'src');

            const possiblePaths = [
                path.join(workspaceRoot, sourceDir, 'layouts', extendsPath),
                path.join(workspaceRoot, sourceDir, 'components', extendsPath),
                path.join(workspaceRoot, sourceDir, extendsPath)
            ];

            for (const possiblePath of possiblePaths) {
                let testPath = possiblePath;
                if (!path.extname(testPath)) {
                    testPath += '.html';
                }

                if (fs.existsSync(testPath)) {
                    return testPath;
                }
            }
        }

        return undefined;
    }

    private formatFileSize(bytes: number): string {
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        if (bytes === 0) {
            return '0 Bytes';
        }
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
    }
}