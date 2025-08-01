# Unify VS Code Extension Installation Guide

## Prerequisites

1. **VS Code**: Version 1.85.0 or higher
2. **Node.js**: Version 14+ (required for Unify CLI)
3. **Unify CLI**: Install in your project with `npm install @fwdslsh/unify`

## Installation Methods

### Method 1: Install from VSIX (Development)

1. **Download the VSIX file**: `unify-preview-0.1.0.vsix`

2. **Install via VS Code**:
   ```bash
   code --install-extension unify-preview-0.1.0.vsix
   ```

3. **Or install via VS Code UI**:
   - Open VS Code
   - Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)
   - Type "Extensions: Install from VSIX..."
   - Select the downloaded VSIX file

### Method 2: Development Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/fwdslsh/unify.git
   cd cli/vscode-extension
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Compile the extension**:
   ```bash
   npm run compile
   ```

4. **Launch for development**:
   - Open the `vscode-extension` folder in VS Code
   - Press `F5` to launch the Extension Development Host
   - Test the extension in the new VS Code window

## Project Setup

### 1. Create a Unify Project

```bash
# Using the CLI
npm install -g @fwdslsh/unify
unify init my-project
cd my-project

# Or manually
mkdir my-project && cd my-project
npm init -y
npm install @fwdslsh/unify
```

### 2. Project Structure

Create a basic Unify project structure:

```
my-project/
├── src/
│   ├── includes/
│   │   ├── head.html
│   │   ├── header.html
│   │   └── footer.html
│   ├── layouts/
│   │   └── default.html
│   └── index.html
├── package.json
└── unify.config.json (optional)
```

### 3. Example Files

**src/includes/head.html**:
```html
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>My Unify Site</title>
<link rel="stylesheet" href="/css/main.css">
```

**src/includes/header.html**:
```html
<header>
    <nav>
        <a href="/">Home</a>
        <a href="/about.html">About</a>
    </nav>
</header>
```

**src/.layouts/default.html**:
```html
<!DOCTYPE html>
<html>
<head>
    <!--#include virtual="/includes/head.html" -->
</head>
<body>
    <!--#include virtual="/includes/header.html" -->
    <main>
        <slot name="content"></slot>
    </main>
    <!--#include virtual="/includes/footer.html" -->
</body>
</html>
```

**src/index.html**:
```html
<template extends="layouts/default.html">
    <template slot="content">
        <h1>Welcome to Unify</h1>
        <p>This is a sample page using Unify includes and templates.</p>
    </template>
</template>
```

## Using the Extension

### 1. Open Your Project

- Open VS Code in your Unify project directory
- The extension should automatically activate (look for "Unify" in the status bar)

### 2. Preview Your Files

- Open any `.html` file in your `src/` directory
- Use `Ctrl+Shift+P` → "Unify: Open Preview"
- Or click the preview icon in the editor toolbar

### 3. Features Available

- **Live Preview**: Changes update automatically as you type
- **Go-to-Definition**: `Ctrl+Click` on includes to navigate to files
- **Auto-completion**: Type `<!--#include ` to get path suggestions
- **Error Detection**: Missing files and syntax errors appear in Problems panel
- **Hover Information**: Hover over includes to see file status and previews

## Configuration

Add these settings to your VS Code `settings.json`:

```json
{
  "unify.preview.autoRefresh": true,
  "unify.preview.debounceDelay": 200,
  "unify.preview.openToSide": true,
  "unify.sourceDirectory": "src",
  "unify.includesDirectory": "includes"
}
```

## Troubleshooting

### Extension Not Activating

1. **Check Unify Detection**:
   - Ensure `@fwdslsh/unify` is in your `package.json` dependencies
   - Or have Unify-style HTML files in your project
   - Check VS Code output panel for "Unify" logs

2. **Verify Project Structure**:
   ```bash
   # Your project should have:
   ls src/              # Source directory
   ls src/includes/     # Includes directory (optional)
   cat package.json     # Should reference @fwdslsh/unify
   ```

### Preview Not Working

1. **Check File Paths**: Ensure include paths are correct relative to your source directory
2. **Verify CLI Installation**: Run `npm list @fwdslsh/unify` in your project
3. **Check Console**: Open VS Code Developer Tools (`Help > Toggle Developer Tools`)

### Performance Issues

1. **Increase Debounce**: Set `unify.preview.debounceDelay` to 500ms or higher
2. **Disable Auto-refresh**: Set `unify.preview.autoRefresh` to `false`
3. **Check File Count**: Large projects may need optimization

### Path Resolution Issues

1. **Virtual vs File Includes**:
   - `virtual="/includes/header.html"` - relative to source root
   - `file="includes/header.html"` - relative to current file

2. **Check Configuration**:
   ```json
   {
     "unify.sourceDirectory": "src",        // Your source folder
     "unify.includesDirectory": "includes"  // Your includes folder name
   }
   ```

## Advanced Usage

### Custom Configuration

Create a `unify.config.json` in your project root:

```json
{
  "source": "src",
  "output": "dist",
  "includes": "includes",
  "baseUrl": "https://mysite.com",
  "prettyUrls": true
}
```

### Workspace Settings

For project-specific settings, create `.vscode/settings.json`:

```json
{
  "unify.sourceDirectory": "content",
  "unify.includesDirectory": "partials",
  "unify.preview.debounceDelay": 300
}
```

### Multiple Source Directories

For complex projects with multiple source directories, configure workspace folders:

1. Open Command Palette (`Ctrl+Shift+P`)
2. "Workspaces: Add Folder to Workspace"
3. Configure each folder's Unify settings

## Uninstallation

### Remove Extension

```bash
code --uninstall-extension unify.unify-preview
```

### Or via VS Code UI

1. Open Extensions panel (`Ctrl+Shift+X`)
2. Find "Unify Preview"
3. Click gear icon → "Uninstall"

## Support

- **Issues**: [GitHub Issues](https://github.com/fwdslsh/unify/issues)
- **Documentation**: [Unify CLI Docs](https://github.com/fwdslsh/unify#readme)
- **Examples**: Check the `/examples` directory in the CLI repository

## License

CC0-1.0 - Public Domain