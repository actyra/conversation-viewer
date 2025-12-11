# Conversation Viewer

A Node.js transformer that converts Claude Code session logs into beautiful, interactive web UIs.

## Features

- **Intelligent Parsing** - Extracts user messages, assistant responses, tool usage, code blocks, and file changes
- **Interactive UI** - Collapsible sections, real-time search, message filtering
- **Dark Theme** - GitHub-inspired design with gradient accents
- **Fully Responsive** - Works on desktop, tablet, and mobile
- **Accessible** - Keyboard navigation, screen reader support, reduced motion support
- **Print-Ready** - Clean print styles for documentation

## Installation

```bash
npm install
```

## Usage

### Basic Usage

Transform the default input file:

```bash
npm run transform
```

### Custom Input/Output

```bash
npx ts-node src/transformer.ts "path/to/input.txt" "path/to/output.html"
```

### Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `input` | Path to the conversation log file | `./2025-12-11-caveat-the-messages-below-were-generated-by-the-u001.txt` |
| `output` | Path for the generated HTML file | `./conversation-viewer.html` |

## Output Features

### Statistics Dashboard
- Total messages count
- Number of conversation sections
- Files touched during the session
- Code blocks extracted

### Interactive Controls
- **Search** - Press `/` to focus, `Escape` to clear
- **Filter** - View only User, Claude, or Tool messages
- **Expand/Collapse** - Navigate large conversations easily
- **Copy Code** - One-click code block copying

### Message Types
- **User** (blue) - Your prompts and questions
- **Assistant** (green) - Claude's responses
- **Tool** (orange) - File operations, searches, commands
- **System** (purple) - System messages and notifications

## Development

### Build TypeScript

```bash
npm run build
```

### Project Structure

```
conversation-viewer/
├── src/
│   └── transformer.ts    # Main transformer script
├── package.json          # Dependencies and scripts
├── tsconfig.json         # TypeScript configuration
└── README.md             # This file
```

## Requirements

- Node.js 18+
- npm or yarn

## License

MIT

---

v1.0.0
