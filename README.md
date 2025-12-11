# Conversation Viewer

A Node.js transformer that converts conversation session logs into beautiful, interactive web UIs.

## Why I Built This

I created this application for two key reasons:

1. **Easy Conversation Search** - To quickly search through Claude Code conversations in an intuitive way, making it simple to find specific exchanges, code changes, or tool usage

2. **Teaching & Demonstrations** - To show students, customers, and clients what Claude Code was doing during a session and what prompts I was using, making it easy to explain AI-assisted development workflows

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

```bash
npx ts-node src/transformer.ts <input-file> <output-file>
```

### Arguments

| Argument | Description | Required |
|----------|-------------|----------|
| `input-file` | Path to the conversation log file (.txt) | Yes |
| `output-file` | Path for the generated HTML file (.html) | Yes |

### Example

```bash
npx ts-node src/transformer.ts conversation.txt output.html
```

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
- **Git** (red) - Git operations (commit, push, pull, etc.)
- **Thinking** (amber) - Claude's reasoning and thought process
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

v1.0.3
