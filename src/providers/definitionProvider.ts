import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ExtensionContext, IncludeInfo, NavigationTarget } from '../types';

export class UnifyDefinitionProvider implements vscode.DefinitionProvider {
    private context: ExtensionContext;

    constructor(context: ExtensionContext) {
        this.context = context;
    }

    async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Definition | undefined> {
        const line = document.lineAt(position);
        const lineText = line.text;

        // Check for include directives
        const includeMatch = this.findIncludeAtPosition(lineText, position.character);
        if (includeMatch) {
            return this.resolveIncludeDefinition(document, includeMatch);
        }

        // Check for template extends
        const templateMatch = this.findTemplateExtendsAtPosition(lineText, position.character);
        if (templateMatch) {
            return this.resolveTemplateDefinition(document, templateMatch);
        }

        // Check for slot references
        const slotMatch = this.findSlotAtPosition(lineText, position.character);
        if (slotMatch) {
            return this.resolveSlotDefinition(document, slotMatch);
        }

        return undefined;
    }

    private findIncludeAtPosition(lineText: string, character: number): IncludeInfo | undefined {
        // Regex to match include directives
        const includeRegex = /<!--#include\s+(virtual|file)=\"([^\"]+)\"\s*-->/g;
        let match;

        while ((match = includeRegex.exec(lineText)) !== null) {
            const [fullMatch, type, includePath] = match;
            const startPos = match.index;
            const endPos = startPos + fullMatch.length;

            // Check if cursor is within the include directive
            if (character >= startPos && character <= endPos) {
                // More specific check for the path portion
                const pathStart = lineText.indexOf('"', startPos) + 1;
                const pathEnd = lineText.indexOf('"', pathStart);

                if (character >= pathStart && character <= pathEnd) {
                    return {
                        type: type as 'virtual' | 'file',
                        path: includePath,
                        range: new vscode.Range(
                            new vscode.Position(0, pathStart),
                            new vscode.Position(0, pathEnd)
                        )
                    };
                }
            }
        }

        return undefined;
    }

    private findTemplateExtendsAtPosition(lineText: string, character: number): string | undefined {
        // Regex to match template extends
        const templateRegex = /<template[^>]+extends=[\"']([^\"']+)[\"'][^>]*>/g;
        let match;

        while ((match = templateRegex.exec(lineText)) !== null) {
            const [fullMatch, extendsPath] = match;
            const startPos = match.index;
            const endPos = startPos + fullMatch.length;

            if (character >= startPos && character <= endPos) {
                // Check if cursor is on the extends path
                const extendsStart = lineText.indexOf('extends=', startPos) + 8;
                const quote = lineText.charAt(extendsStart);
                const pathStart = extendsStart + 1;
                const pathEnd = lineText.indexOf(quote, pathStart);

                if (character >= pathStart && character <= pathEnd) {
                    return extendsPath;
                }
            }
        }

        return undefined;
    }

    private findSlotAtPosition(lineText: string, character: number): string | undefined {
        // Regex to match slot elements
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

    private async resolveIncludeDefinition(
        document: vscode.TextDocument,
        includeInfo: IncludeInfo
    ): Promise<vscode.Location | undefined> {
        const workspaceRoot = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath;
        if (!workspaceRoot) {
            return undefined;
        }

        let resolvedPath: string;

        if (includeInfo.type === 'virtual') {
            // Virtual includes are relative to source root
            const config = vscode.workspace.getConfiguration('unify');
            const sourceDir = config.get<string>('sourceDirectory', 'src');
            resolvedPath = path.join(workspaceRoot, sourceDir, includeInfo.path);
        } else {
            // File includes are relative to current file
            resolvedPath = path.resolve(path.dirname(document.fileName), includeInfo.path);
        }

        // Check if file exists
        if (!fs.existsSync(resolvedPath)) {
            // Try with common extensions
            const extensions = ['.html', '.htm', '.md'];
            let found = false;
            
            for (const ext of extensions) {
                const pathWithExt = resolvedPath + ext;
                if (fs.existsSync(pathWithExt)) {
                    resolvedPath = pathWithExt;
                    found = true;
                    break;
                }
            }

            if (!found) {
                this.context.outputChannel.appendLine(`Include file not found: ${resolvedPath}`);
                return undefined;
            }
        }

        return new vscode.Location(
            vscode.Uri.file(resolvedPath),
            new vscode.Position(0, 0)
        );
    }

    private async resolveTemplateDefinition(
        document: vscode.TextDocument,
        extendsPath: string
    ): Promise<vscode.Location | undefined> {
        const workspaceRoot = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath;
        if (!workspaceRoot) {
            return undefined;
        }

        // Template extends are typically relative to layouts or components directory
        const config = vscode.workspace.getConfiguration('unify');
        const sourceDir = config.get<string>('sourceDirectory', 'src');

        // Try different possible locations
        const possiblePaths = [
            path.join(workspaceRoot, sourceDir, 'layouts', extendsPath),
            path.join(workspaceRoot, sourceDir, 'components', extendsPath),
            path.join(workspaceRoot, sourceDir, extendsPath),
            path.resolve(path.dirname(document.fileName), extendsPath)
        ];

        for (const possiblePath of possiblePaths) {
            let resolvedPath = possiblePath;
            
            // Add .html extension if not present
            if (!path.extname(resolvedPath)) {
                resolvedPath += '.html';
            }

            if (fs.existsSync(resolvedPath)) {
                return new vscode.Location(
                    vscode.Uri.file(resolvedPath),
                    new vscode.Position(0, 0)
                );
            }
        }

        this.context.outputChannel.appendLine(`Template file not found: ${extendsPath}`);
        return undefined;
    }

    private async resolveSlotDefinition(
        document: vscode.TextDocument,
        slotName: string
    ): Promise<vscode.Location[] | undefined> {
        // For slots, we want to find all definitions and usages
        const locations: vscode.Location[] = [];

        // Search in current document
        const currentDocLocations = this.findSlotDefinitionsInDocument(document, slotName);
        locations.push(...currentDocLocations);

        // Search in extended templates
        const extendedTemplate = await this.findExtendedTemplate(document);
        if (extendedTemplate) {
            const templateDoc = await vscode.workspace.openTextDocument(extendedTemplate);
            const templateLocations = this.findSlotDefinitionsInDocument(templateDoc, slotName);
            locations.push(...templateLocations);
        }

        return locations.length > 0 ? locations : undefined;
    }

    private findSlotDefinitionsInDocument(document: vscode.TextDocument, slotName: string): vscode.Location[] {
        const locations: vscode.Location[] = [];
        const text = document.getText();
        const lines = text.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            // Find slot definitions: <slot name="slotName">
            const slotDefRegex = new RegExp(`<slot[^>]+name=[\"']${slotName}[\"'][^>]*>`, 'g');
            let match;

            while ((match = slotDefRegex.exec(line)) !== null) {
                const startPos = new vscode.Position(i, match.index);
                const endPos = new vscode.Position(i, match.index + match[0].length);
                locations.push(new vscode.Location(document.uri, new vscode.Range(startPos, endPos)));
            }

            // Find slot usage in template blocks
            const slotUsageRegex = new RegExp(`<template[^>]*slot=[\"']${slotName}[\"'][^>]*>`, 'g');
            while ((match = slotUsageRegex.exec(line)) !== null) {
                const startPos = new vscode.Position(i, match.index);
                const endPos = new vscode.Position(i, match.index + match[0].length);
                locations.push(new vscode.Location(document.uri, new vscode.Range(startPos, endPos)));
            }
        }

        return locations;
    }

    private async findExtendedTemplate(document: vscode.TextDocument): Promise<string | undefined> {
        const text = document.getText();
        const templateMatch = text.match(/<template[^>]+extends=[\"']([^\"']+)[\"'][^>]*>/);
        
        if (templateMatch) {
            const extendsPath = templateMatch[1];
            const definition = await this.resolveTemplateDefinition(document, extendsPath);
            return definition instanceof vscode.Location ? definition.uri.fsPath : undefined;
        }

        return undefined;
    }
}