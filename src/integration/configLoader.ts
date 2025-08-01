import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { UnifyConfig } from '../types';

export class ConfigLoader {
    private workspaceRoot: string;
    private config: UnifyConfig;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
        this.config = this.getDefaultConfig();
    }

    async loadConfig(): Promise<UnifyConfig> {
        // Load from VS Code settings
        const vsCodeConfig = this.loadFromVSCodeSettings();
        
        // Load from config files
        const fileConfig = await this.loadFromConfigFile();
        
        // Load from package.json
        const packageConfig = await this.loadFromPackageJson();

        // Merge configs (VS Code settings take precedence)
        this.config = {
            ...this.getDefaultConfig(),
            ...fileConfig,
            ...packageConfig,
            ...vsCodeConfig
        };

        return this.config;
    }

    private getDefaultConfig(): UnifyConfig {
        return {
            source: 'src',
            output: 'dist',
            includes: 'includes',
            baseUrl: 'https://example.com',
            prettyUrls: false
        };
    }

    private loadFromVSCodeSettings(): Partial<UnifyConfig> {
        const config = vscode.workspace.getConfiguration('unify');
        
        return {
            source: config.get('sourceDirectory'),
            includes: config.get('includesDirectory'),
            prettyUrls: config.get('preview.prettyUrls'),
            head: config.get('headFile')
        };
    }

    private async loadFromConfigFile(): Promise<Partial<UnifyConfig>> {
        const configFiles = [
            'unify.config.js',
            'unify.config.json',
            'unify.config.mjs',
            '.unifyrc',
            '.unifyrc.json'
        ];

        for (const configFile of configFiles) {
            const configPath = path.join(this.workspaceRoot, configFile);
            
            if (fs.existsSync(configPath)) {
                try {
                    if (configFile.endsWith('.json') || configFile === '.unifyrc') {
                        const content = fs.readFileSync(configPath, 'utf-8');
                        return JSON.parse(content);
                    } else if (configFile.endsWith('.js') || configFile.endsWith('.mjs')) {
                        // For JS config files, we'd need to use dynamic import
                        // For now, skip JS configs in VS Code extension
                        continue;
                    }
                } catch (error) {
                    console.warn(`Failed to load config from ${configFile}:`, error);
                }
            }
        }

        return {};
    }

    private async loadFromPackageJson(): Promise<Partial<UnifyConfig>> {
        const packageJsonPath = path.join(this.workspaceRoot, 'package.json');
        
        if (!fs.existsSync(packageJsonPath)) {
            return {};
        }

        try {
            const content = fs.readFileSync(packageJsonPath, 'utf-8');
            const packageJson = JSON.parse(content);
            
            // Look for unify config in package.json
            if (packageJson.unify) {
                return packageJson.unify;
            }

            // Infer config from scripts
            const config: Partial<UnifyConfig> = {};
            
            if (packageJson.scripts?.build) {
                const buildScript = packageJson.scripts.build;
                
                // Parse common CLI arguments
                const sourceMatch = buildScript.match(/--source\s+(\S+)/);
                if (sourceMatch) {
                    config.source = sourceMatch[1];
                }
                
                const outputMatch = buildScript.match(/--output\s+(\S+)/);
                if (outputMatch) {
                    config.output = outputMatch[1];
                }
                
                const includesMatch = buildScript.match(/--includes\s+(\S+)/);
                if (includesMatch) {
                    config.includes = includesMatch[1];
                }
                
                if (buildScript.includes('--pretty-urls')) {
                    config.prettyUrls = true;
                }
                
                const baseUrlMatch = buildScript.match(/--base-url\s+(\S+)/);
                if (baseUrlMatch) {
                    config.baseUrl = baseUrlMatch[1];
                }
            }

            return config;
        } catch (error) {
            console.warn('Failed to load config from package.json:', error);
            return {};
        }
    }

    getConfig(): UnifyConfig {
        return { ...this.config };
    }

    async watchConfigChanges(callback: (config: UnifyConfig) => void): Promise<vscode.Disposable> {
        const watchers: vscode.Disposable[] = [];

        // Watch VS Code settings
        const settingsWatcher = vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('unify')) {
                this.loadConfig().then(callback);
            }
        });
        watchers.push(settingsWatcher);

        // Watch config files
        const configPattern = new vscode.RelativePattern(
            this.workspaceRoot,
            '{unify.config.*,.unifyrc*,package.json}'
        );
        
        const fileWatcher = vscode.workspace.createFileSystemWatcher(configPattern);
        fileWatcher.onDidChange(() => this.loadConfig().then(callback));
        fileWatcher.onDidCreate(() => this.loadConfig().then(callback));
        fileWatcher.onDidDelete(() => this.loadConfig().then(callback));
        watchers.push(fileWatcher);

        return {
            dispose() {
                watchers.forEach(w => w.dispose());
            }
        };
    }

    validateConfig(config: UnifyConfig): string[] {
        const errors: string[] = [];
        
        // Check if source directory exists
        const sourcePath = path.join(this.workspaceRoot, config.source);
        if (!fs.existsSync(sourcePath)) {
            errors.push(`Source directory does not exist: ${config.source}`);
        }

        // Check if includes directory exists (within source)
        const includesPath = path.join(sourcePath, config.includes);
        if (!fs.existsSync(includesPath)) {
            // This is a warning, not an error
            console.warn(`Includes directory does not exist: ${config.includes}`);
        }

        // Validate base URL format
        if (config.baseUrl) {
            try {
                new URL(config.baseUrl);
            } catch {
                errors.push(`Invalid base URL format: ${config.baseUrl}`);
            }
        }

        return errors;
    }
}