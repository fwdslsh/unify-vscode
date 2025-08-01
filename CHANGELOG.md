# Change Log

All notable changes to the Unify Preview extension will be documented in this file.

## [0.1.0] - 2025-01-26

### Added
- Initial release of Unify Preview extension
- Live preview panel with real-time rendering
- Support for Unify include directives (`<!--#include -->`)
- Template system support with `<template extends="">` and `<slot>` elements
- Go-to-definition for includes, templates, and slots
- Auto-completion for file paths and slot names
- Hover information with file previews and status
- Comprehensive error diagnostics and validation
- Syntax highlighting for Unify-specific elements
- Integration with VS Code Problems panel
- Automatic workspace detection for Unify projects
- Configurable settings for preview behavior
- Theme-aware preview styling
- Debounced updates for performance
- Support for both Apache SSI and DOM mode syntax
- Markdown processing with frontmatter support

### Features
- **Live Preview**: Real-time preview that updates as you type
- **Navigation**: Click-to-navigate for includes and templates  
- **IntelliSense**: Smart auto-completion and hover hints
- **Error Detection**: Real-time validation with actionable error messages
- **Performance**: Optimized with debouncing and selective updates
- **Security**: Strict CSP implementation for WebView content

### Supported File Types
- HTML files (`.html`, `.htm`)
- Markdown files (`.md`) with frontmatter
- Unify configuration files

### Commands
- `unify.openPreview` - Open preview in current column
- `unify.previewToSide` - Open preview in side column  
- `unify.refreshPreview` - Manually refresh preview

### Configuration Options
- `unify.preview.autoRefresh` - Enable/disable auto-refresh
- `unify.preview.debounceDelay` - Delay before updating preview
- `unify.preview.openToSide` - Open preview in side column
- `unify.sourceDirectory` - Source directory path
- `unify.includesDirectory` - Includes directory name

### Technical Implementation
- Direct integration with `@fwdslsh/unify` package
- TypeScript implementation with strict typing
- Comprehensive error handling and recovery
- Memory-efficient WebView management
- Cross-platform compatibility

### Known Limitations
- Requires `@fwdslsh/unify` to be installed in the workspace
- Preview updates may be slower for very large projects
- Some advanced Unify features may not be fully supported in preview

---

## Future Releases

### Planned for 0.2.0
- Enhanced DOM mode support
- Code action providers for quick fixes
- Improved performance for large projects
- Additional snippet support
- Better error recovery and suggestions

### Planned for 0.3.0
- Live collaboration features
- Advanced template debugging
- Component palette
- Build integration
- Enhanced theming support