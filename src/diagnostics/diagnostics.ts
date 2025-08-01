import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ExtensionContext, UnifyDiagnosticData } from '../types';

export class UnifyDiagnostics {
    private context: ExtensionContext;
    private updateTimeout: Map<string, NodeJS.Timeout> = new Map();

    constructor(context: ExtensionContext) {
        this.context = context;
        this.setupEventListeners();
    }

    private setupEventListeners() {
        // Listen for document changes
        const changeListener = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.languageId === 'html') {
                this.scheduleUpdate(e.document);
            }
        });

        // Listen for document saves
        const saveListener = vscode.workspace.onDidSaveTextDocument(document => {
            if (document.languageId === 'html') {
                this.updateDiagnostics(document);
            }
        });

        // Listen for file changes (external changes)
        const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*.{html,htm,md}');
        fileWatcher.onDidChange(uri => {
            const document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === uri.toString());
            if (document) {
                this.updateDiagnostics(document);
            }
        });

        this.context.extensionContext.subscriptions.push(
            changeListener,
            saveListener,
            fileWatcher
        );
    }

    private scheduleUpdate(document: vscode.TextDocument) {
        const uri = document.uri.toString();
        
        // Clear existing timeout
        const existingTimeout = this.updateTimeout.get(uri);
        if (existingTimeout) {
            clearTimeout(existingTimeout);
        }

        // Schedule new update with debouncing
        const config = vscode.workspace.getConfiguration('unify');
        const debounceDelay = config.get<number>('preview.debounceDelay', 200);

        const timeout = setTimeout(() => {
            this.updateDiagnostics(document);
            this.updateTimeout.delete(uri);
        }, debounceDelay);

        this.updateTimeout.set(uri, timeout);
    }

    async updateDiagnostics(document: vscode.TextDocument) {
        try {
            const diagnostics = await this.analyzeDocument(document);
            this.context.diagnostics.set(document.uri, diagnostics);
            
            this.context.outputChannel.appendLine(`Updated diagnostics for ${document.fileName}: ${diagnostics.length} issues found`);
        } catch (error) {
            this.context.outputChannel.appendLine(`Failed to update diagnostics: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async analyzeDocument(document: vscode.TextDocument): Promise<vscode.Diagnostic[]> {
        const diagnostics: vscode.Diagnostic[] = [];
        const text = document.getText();
        const lines = text.split('\n');

        // Analyze includes
        const includeIssues = await this.analyzeIncludes(document, lines);
        diagnostics.push(...includeIssues);

        // Analyze template structure
        const templateIssues = await this.analyzeTemplates(document, lines);
        diagnostics.push(...templateIssues);

        // Analyze slots
        const slotIssues = await this.analyzeSlots(document, lines);
        diagnostics.push(...slotIssues);

        // Analyze syntax issues
        const syntaxIssues = this.analyzeSyntax(document, lines);
        diagnostics.push(...syntaxIssues);

        return diagnostics;
    }

    private async analyzeIncludes(document: vscode.TextDocument, lines: string[]): Promise<vscode.Diagnostic[]> {
        const diagnostics: vscode.Diagnostic[] = [];
        const workspaceRoot = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath;
        
        if (!workspaceRoot) {
            return diagnostics;
        }

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const includeRegex = /<!--#include\s+(virtual|file)=\"([^\"]+)\"\s*-->/g;
            let match;

            while ((match = includeRegex.exec(line)) !== null) {
                const [fullMatch, type, includePath] = match;
                const startChar = match.index;
                const endChar = startChar + fullMatch.length;

                // Resolve include path
                const resolvedPath = await this.resolveIncludePath(
                    document,
                    type as 'virtual' | 'file',
                    includePath,
                    workspaceRoot
                );

                if (!resolvedPath.exists) {
                    const range = new vscode.Range(
                        new vscode.Position(i, startChar),
                        new vscode.Position(i, endChar)
                    );

                    const diagnostic = new vscode.Diagnostic(
                        range,
                        `Include file not found: ${includePath}`,
                        vscode.DiagnosticSeverity.Error
                    );

                    diagnostic.code = 'include-not-found';
                    diagnostic.source = 'Unify';

                    // Add code actions
                    if (resolvedPath.expectedPath) {
                        const suggestion = this.createIncludeFileSuggestion(resolvedPath.expectedPath);
                        diagnostic.relatedInformation = [
                            new vscode.DiagnosticRelatedInformation(
                                new vscode.Location(document.uri, range),
                                suggestion
                            )
                        ];
                    }

                    diagnostics.push(diagnostic);
                } else if (resolvedPath.circular) {
                    const range = new vscode.Range(
                        new vscode.Position(i, startChar),
                        new vscode.Position(i, endChar)
                    );

                    const diagnostic = new vscode.Diagnostic(
                        range,
                        `Circular include dependency detected: ${includePath}`,
                        vscode.DiagnosticSeverity.Error
                    );

                    diagnostic.code = 'circular-include';
                    diagnostic.source = 'Unify';
                    diagnostics.push(diagnostic);
                }
            }
        }

        return diagnostics;
    }

    private async analyzeTemplates(document: vscode.TextDocument, lines: string[]): Promise<vscode.Diagnostic[]> {
        const diagnostics: vscode.Diagnostic[] = [];
        const workspaceRoot = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath;
        
        if (!workspaceRoot) {
            return diagnostics;
        }

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const templateRegex = /<template[^>]+extends=[\"']([^\"']+)[\"'][^>]*>/g;
            let match;

            while ((match = templateRegex.exec(line)) !== null) {
                const [fullMatch, extendsPath] = match;
                const startChar = match.index;
                const endChar = startChar + fullMatch.length;

                // Check if template file exists
                const templatePath = await this.resolveTemplatePath(document, extendsPath, workspaceRoot);

                if (!templatePath) {
                    const range = new vscode.Range(
                        new vscode.Position(i, startChar),
                        new vscode.Position(i, endChar)
                    );

                    const diagnostic = new vscode.Diagnostic(
                        range,
                        `Template not found: ${extendsPath}`,
                        vscode.DiagnosticSeverity.Error
                    );

                    diagnostic.code = 'template-not-found';
                    diagnostic.source = 'Unify';
                    diagnostics.push(diagnostic);
                }
            }
        }

        return diagnostics;
    }

    private async analyzeSlots(document: vscode.TextDocument, lines: string[]): Promise<vscode.Diagnostic[]> {
        const diagnostics: vscode.Diagnostic[] = [];
        
        // Find extended template
        const extendedTemplate = await this.findExtendedTemplate(document);
        if (!extendedTemplate) {
            return diagnostics; // No template to validate against
        }

        try {
            // Read template file to get available slots
            const templateContent = fs.readFileSync(extendedTemplate, 'utf-8');
            const availableSlots = this.extractSlots(templateContent);
            const usedSlots = new Set<string>();

            // Check slot usage in current document
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const slotRegex = /<template[^>]+slot=[\"']([^\"']+)[\"'][^>]*>/g;
                let match;

                while ((match = slotRegex.exec(line)) !== null) {
                    const [fullMatch, slotName] = match;
                    const startChar = match.index;
                    const endChar = startChar + fullMatch.length;

                    usedSlots.add(slotName);

                    if (!availableSlots.includes(slotName)) {
                        const range = new vscode.Range(
                            new vscode.Position(i, startChar),
                            new vscode.Position(i, endChar)
                        );

                        const diagnostic = new vscode.Diagnostic(
                            range,
                            `Slot '${slotName}' is not defined in the extended template`,
                            vscode.DiagnosticSeverity.Warning
                        );

                        diagnostic.code = 'undefined-slot';
                        diagnostic.source = 'Unify';

                        // Suggest available slots
                        if (availableSlots.length > 0) {
                            const suggestions = availableSlots.join(', ');
                            diagnostic.relatedInformation = [
                                new vscode.DiagnosticRelatedInformation(
                                    new vscode.Location(document.uri, range),
                                    `Available slots: ${suggestions}`
                                )
                            ];
                        }

                        diagnostics.push(diagnostic);
                    }
                }
            }

            // Check for unused required slots (if template defines required slots)
            // This would require additional metadata in the template
            
        } catch (error) {
            // Template file couldn't be read, but this isn't necessarily an error
            // as the template analysis will catch missing files
        }

        return diagnostics;
    }

    private analyzeSyntax(document: vscode.TextDocument, lines: string[]): vscode.Diagnostic[] {
        const diagnostics: vscode.Diagnostic[] = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Check for malformed include directives
            const malformedInclude = /<!--#include\s+(?!virtual=|file=)/g;
            let match = malformedInclude.exec(line);
            if (match) {
                const range = new vscode.Range(
                    new vscode.Position(i, match.index),
                    new vscode.Position(i, match.index + match[0].length)
                );

                const diagnostic = new vscode.Diagnostic(
                    range,
                    'Malformed include directive. Use virtual="path" or file="path"',
                    vscode.DiagnosticSeverity.Error
                );

                diagnostic.code = 'malformed-include';
                diagnostic.source = 'Unify';
                diagnostics.push(diagnostic);
            }

            // Check for unclosed template tags
            const openTemplate = /<template[^>]*>(?!.*<\/template>)/g;
            match = openTemplate.exec(line);
            if (match) {
                // This is a simple check - a more sophisticated parser would track across lines
                const range = new vscode.Range(
                    new vscode.Position(i, match.index),
                    new vscode.Position(i, match.index + match[0].length)
                );

                const diagnostic = new vscode.Diagnostic(
                    range,
                    'Template tag may not be properly closed',
                    vscode.DiagnosticSeverity.Information
                );

                diagnostic.code = 'unclosed-template';
                diagnostic.source = 'Unify';
                diagnostics.push(diagnostic);
            }

            // Check for invalid characters in paths
            const includeWithInvalidChars = /<!--#include\s+(virtual|file)=\"([^\"]*[<>|*?]+[^\"]*)\"/g;
            match = includeWithInvalidChars.exec(line);
            if (match) {
                const range = new vscode.Range(
                    new vscode.Position(i, match.index),
                    new vscode.Position(i, match.index + match[0].length)
                );

                const diagnostic = new vscode.Diagnostic(
                    range,
                    'Include path contains invalid characters',
                    vscode.DiagnosticSeverity.Error
                );

                diagnostic.code = 'invalid-path-chars';
                diagnostic.source = 'Unify';
                diagnostics.push(diagnostic);
            }
        }

        return diagnostics;
    }

    private async resolveIncludePath(
        document: vscode.TextDocument,
        type: 'virtual' | 'file',
        includePath: string,
        workspaceRoot: string
    ): Promise<{ exists: boolean; expectedPath?: string; circular?: boolean }> {
        let resolvedPath: string;

        if (type === 'virtual') {
            const config = vscode.workspace.getConfiguration('unify');
            const sourceDir = config.get<string>('sourceDirectory', 'src');
            resolvedPath = path.join(workspaceRoot, sourceDir, includePath);
        } else {
            resolvedPath = path.resolve(path.dirname(document.fileName), includePath);
        }

        // Check if file exists
        let exists = fs.existsSync(resolvedPath);
        let finalPath = resolvedPath;

        if (!exists) {
            // Try with extensions
            const extensions = ['.html', '.htm', '.md'];
            for (const ext of extensions) {
                const pathWithExt = resolvedPath + ext;
                if (fs.existsSync(pathWithExt)) {
                    exists = true;
                    finalPath = pathWithExt;
                    break;
                }
            }
        }

        // Check for circular dependencies (simplified)
        let circular = false;
        if (exists) {
            circular = await this.checkCircularIncludes(document.fileName, finalPath, new Set());
        }

        return {
            exists,
            expectedPath: finalPath,
            circular
        };
    }

    private async checkCircularIncludes(
        currentFile: string,
        targetFile: string,
        visited: Set<string>
    ): Promise<boolean> {
        if (visited.has(currentFile)) {
            return true; // Circular dependency found
        }

        if (currentFile === targetFile) {
            return true; // Direct circular reference
        }

        visited.add(currentFile);

        try {
            const content = fs.readFileSync(targetFile, 'utf-8');
            const includeRegex = /<!--#include\s+(virtual|file)=\"([^\"]+)\"\s*-->/g;
            let match;

            while ((match = includeRegex.exec(content)) !== null) {
                const [, type, includePath] = match;
                
                // Resolve this include and check recursively
                let nextPath: string;
                if (type === 'virtual') {
                    const config = vscode.workspace.getConfiguration('unify');
                    const sourceDir = config.get<string>('sourceDirectory', 'src');
                    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
                    nextPath = path.join(workspaceRoot, sourceDir, includePath);
                } else {
                    nextPath = path.resolve(path.dirname(targetFile), includePath);
                }

                if (fs.existsSync(nextPath)) {
                    const hasCircular = await this.checkCircularIncludes(currentFile, nextPath, new Set(visited));
                    if (hasCircular) {
                        return true;
                    }
                }
            }
        } catch (error) {
            // File read error, ignore for circular check
        }

        return false;
    }

    private async resolveTemplatePath(
        document: vscode.TextDocument,
        extendsPath: string,
        workspaceRoot: string
    ): Promise<string | undefined> {
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

        return undefined;
    }

    private async findExtendedTemplate(document: vscode.TextDocument): Promise<string | undefined> {
        const text = document.getText();
        const templateMatch = text.match(/<template[^>]+extends=[\"']([^\"']+)[\"'][^>]*>/);
        
        if (templateMatch) {
            const extendsPath = templateMatch[1];
            const workspaceRoot = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath;
            if (workspaceRoot) {
                return this.resolveTemplatePath(document, extendsPath, workspaceRoot);
            }
        }

        return undefined;
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

    private createIncludeFileSuggestion(expectedPath: string): string {
        const dir = path.dirname(expectedPath);
        const fileName = path.basename(expectedPath);
        
        if (fs.existsSync(dir)) {
            return `Create missing include file: ${fileName}`;
        } else {
            return `Create directory and include file: ${expectedPath}`;
        }
    }

    dispose() {
        // Clear all timeouts
        for (const timeout of this.updateTimeout.values()) {
            clearTimeout(timeout);
        }
        this.updateTimeout.clear();
        
        // Clear diagnostics
        this.context.diagnostics.clear();
    }
}