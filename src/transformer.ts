import * as fs from 'fs';
import * as path from 'path';

// Types for parsed conversation elements
interface ConversationMessage {
  type: 'user' | 'assistant' | 'system' | 'tool' | 'thinking' | 'git';
  content: string;
  timestamp?: string;
  toolName?: string;
  fileName?: string;
  isGitAction?: boolean;
}

interface CodeBlock {
  language: string;
  code: string;
  fileName?: string;
}

interface FileChange {
  fileName: string;
  type: 'read' | 'update' | 'create' | 'search';
  details: string;
  lineNumbers?: string;
}

interface ConversationSection {
  title: string;
  messages: ConversationMessage[];
  codeBlocks: CodeBlock[];
  fileChanges: FileChange[];
  summary?: string;
}

interface ParsedConversation {
  title: string;
  date: string;
  model: string;
  projectPath: string;
  sections: ConversationSection[];
  statistics: {
    totalMessages: number;
    userMessages: number;
    assistantMessages: number;
    thinkingMessages: number;
    toolMessages: number;
    gitMessages: number;
    filesModified: number;
    codeBlocksCount: number;
    emojiCounts: Record<string, number>;
  };
}

// Parser class
class ConversationParser {
  private content: string;
  private lines: string[];

  constructor(content: string) {
    this.content = content;
    // Remove line number prefixes (e.g., "     1→")
    this.lines = content.split('\n').map(line => {
      const match = line.match(/^\s*\d+→(.*)$/);
      return match ? match[1] : line;
    });
  }

  parse(): ParsedConversation {
    const sections: ConversationSection[] = [];
    let currentSection: ConversationSection = {
      title: 'Session Start',
      messages: [],
      codeBlocks: [],
      fileChanges: []
    };

    let currentMessage: ConversationMessage | null = null;
    let inCodeBlock = false;
    let codeBlockContent = '';
    let codeBlockLang = '';

    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i];

      // Detect user prompts (lines starting with "> ")
      if (line.startsWith('> ')) {
        if (currentMessage) {
          currentSection.messages.push(currentMessage);
        }

        // Collect multi-line user input
        let userInput = line.substring(2);
        while (i + 1 < this.lines.length && !this.lines[i + 1].startsWith('●') && !this.lines[i + 1].startsWith('> ')) {
          i++;
          if (this.lines[i].trim()) {
            userInput += '\n' + this.lines[i];
          }
        }

        currentMessage = {
          type: 'user',
          content: userInput.trim()
        };

        // Check if this starts a new section (major topic change)
        if (userInput.length > 50 || userInput.includes('?')) {
          if (currentSection.messages.length > 0) {
            sections.push(currentSection);
            currentSection = {
              title: this.extractTitle(userInput),
              messages: [],
              codeBlocks: [],
              fileChanges: []
            };
          }
        }
        continue;
      }

      // Detect tool usage FIRST (before assistant) - comprehensive list of all tools
      const toolPattern = /● (Read|Write|Edit|Bash|Grep|Glob|Search|Update|TodoWrite|MultiEdit|Task|WebFetch|WebSearch|NotebookEdit|AskUserQuestion|ExitPlanMode|EnterPlanMode|KillShell|TaskOutput|Skill|SlashCommand)\(/;
      if (toolPattern.test(line)) {
        const toolMatch = line.match(/● (\w+)\(([^)]*)\)?/);
        if (toolMatch) {
          const toolName = toolMatch[1];
          const toolArg = toolMatch[2] || '';

          // Check if this is a git command
          const isGitCommand = toolName === 'Bash' && /\bgit\b/.test(toolArg);

          // Determine file change type
          let changeType: 'read' | 'update' | 'create' | 'search' = 'read';
          if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(toolName)) {
            changeType = 'update';
          } else if (['Grep', 'Glob', 'Search', 'WebSearch'].includes(toolName)) {
            changeType = 'search';
          }

          if (toolArg) {
            const fileChange: FileChange = {
              fileName: toolArg,
              type: changeType,
              details: line
            };
            currentSection.fileChanges.push(fileChange);
          }

          if (currentMessage) {
            currentSection.messages.push(currentMessage);
          }
          currentMessage = {
            type: isGitCommand ? 'git' : 'tool',
            toolName: isGitCommand ? 'Git' : toolName,
            fileName: toolArg || undefined,
            content: line,
            isGitAction: isGitCommand
          };
        }
        continue;
      }

      // Detect assistant responses (lines starting with "● " but not tools)
      if (line.startsWith('● ')) {
        if (currentMessage) {
          currentSection.messages.push(currentMessage);
        }
        currentMessage = {
          type: 'assistant',
          content: line.substring(2)
        };
        continue;
      }

      // Detect thinking blocks (specific thinking markers only)
      if (line.match(/^\s*<thinking>/) || line.match(/^\s*\[thinking\]/i) || line.match(/^thinking:/i)) {
        if (currentMessage) {
          currentSection.messages.push(currentMessage);
        }
        currentMessage = {
          type: 'thinking',
          content: line
        };
        continue;
      }

      // Detect tool results (lines starting with "  ⎿  ")
      if (line.includes('⎿')) {
        if (currentMessage && (currentMessage.type === 'tool' || currentMessage.type === 'git')) {
          currentMessage.content += '\n' + line;
        }
        continue;
      }

      // Detect code blocks
      if (line.trim().startsWith('```')) {
        if (inCodeBlock) {
          // End of code block
          currentSection.codeBlocks.push({
            language: codeBlockLang,
            code: codeBlockContent.trim()
          });
          inCodeBlock = false;
          codeBlockContent = '';
        } else {
          // Start of code block
          inCodeBlock = true;
          codeBlockLang = line.trim().substring(3) || 'text';
        }
        continue;
      }

      if (inCodeBlock) {
        codeBlockContent += line + '\n';
        continue;
      }

      // Continue building current message
      if (currentMessage && line.trim()) {
        if (line.startsWith('  ') || line.startsWith('   ')) {
          currentMessage.content += '\n' + line;
        }
      }
    }

    // Add last message and section
    if (currentMessage) {
      currentSection.messages.push(currentMessage);
    }
    if (currentSection.messages.length > 0) {
      sections.push(currentSection);
    }

    // Extract metadata
    const metadata = this.extractMetadata();

    return {
      title: metadata.title,
      date: metadata.date,
      model: metadata.model,
      projectPath: metadata.projectPath,
      sections,
      statistics: this.calculateStatistics(sections)
    };
  }

  private extractTitle(text: string): string {
    // Create a meaningful title from the first significant words
    const words = text.split(/\s+/).slice(0, 6);
    let title = words.join(' ');
    if (title.length > 50) {
      title = title.substring(0, 47) + '...';
    }
    return title || 'Conversation';
  }

  private extractMetadata() {
    let title = 'Claude Code Session';
    let date = new Date().toISOString().split('T')[0];
    let model = 'Claude';
    let projectPath = '';

    // Look for metadata in the header
    for (const line of this.lines.slice(0, 20)) {
      if (line.includes('Opus')) {
        model = 'Claude Opus 4.5';
      }
      if (line.includes('Sonnet')) {
        model = 'Claude Sonnet';
      }
      if (line.match(/C:\\.*|\/.*\//)) {
        const pathMatch = line.match(/(C:\\[^\s]+|\/[^\s]+)/);
        if (pathMatch) {
          projectPath = pathMatch[1];
        }
      }
    }

    // Extract date from filename if possible
    const dateMatch = this.content.match(/(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) {
      date = dateMatch[1];
    }

    return { title, date, model, projectPath };
  }

  private calculateStatistics(sections: ConversationSection[]) {
    let totalMessages = 0;
    let userMessages = 0;
    let assistantMessages = 0;
    let thinkingMessages = 0;
    let toolMessages = 0;
    let gitMessages = 0;
    let filesModified = new Set<string>();
    let codeBlocksCount = 0;
    let emojiCounts: Record<string, number> = {};

    // Emoji regex pattern - canonical emoji ranges
    const emojiRegex = /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{FE00}-\u{FE0F}]|[\u{1F900}-\u{1F9FF}]|[\u{1F1E6}-\u{1F1FF}]/gu;

    for (const section of sections) {
      for (const message of section.messages) {
        totalMessages++;
        if (message.type === 'user') userMessages++;
        if (message.type === 'assistant') assistantMessages++;
        if (message.type === 'thinking') thinkingMessages++;
        if (message.type === 'git') gitMessages++;
        if (message.type === 'tool') {
          toolMessages++;
          if (message.fileName) {
            filesModified.add(message.fileName);
          }
        }

        // Count emojis in message content
        const emojis = message.content.match(emojiRegex);
        if (emojis) {
          for (const emoji of emojis) {
            emojiCounts[emoji] = (emojiCounts[emoji] || 0) + 1;
          }
        }
      }
      codeBlocksCount += section.codeBlocks.length;
    }

    return {
      totalMessages,
      userMessages,
      assistantMessages,
      thinkingMessages,
      toolMessages,
      gitMessages,
      filesModified: filesModified.size,
      codeBlocksCount,
      emojiCounts
    };
  }
}

// HTML Generator
function generateHTML(parsed: ParsedConversation): string {
  const escapeHtml = (text: string) => {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  const formatContent = (content: string) => {
    let formatted = escapeHtml(content);
    // Convert markdown-like formatting
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    formatted = formatted.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
    formatted = formatted.replace(/\n/g, '<br>');
    return formatted;
  };

  const sectionsHTML = parsed.sections.map((section, index) => {
    const messagesHTML = section.messages.map(msg => {
      const iconMap: Record<string, string> = {
        user: `<svg class="message-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`,
        assistant: `<svg class="message-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"></path><path d="M2 17l10 5 10-5"></path><path d="M2 12l10 5 10-5"></path></svg>`,
        tool: `<svg class="message-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>`,
        git: `<svg class="message-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="18" r="3"></circle><circle cx="6" cy="6" r="3"></circle><path d="M6 21V9a9 9 0 0 0 9 9"></path></svg>`,
        thinking: `<svg class="message-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M12 6v6l4 2"></path></svg>`,
        system: `<svg class="message-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path></svg>`
      };

      const labelMap: Record<string, string> = {
        user: 'You',
        assistant: 'Claude',
        tool: msg.toolName || 'Tool',
        git: 'Git',
        thinking: 'Thinking',
        system: 'System'
      };

      return `
        <div class="message message-${msg.type}">
          <div class="message-header">
            ${iconMap[msg.type] || iconMap.system}
            <span class="message-label">${labelMap[msg.type]}</span>
            ${msg.fileName && msg.type !== 'git' && msg.type !== 'thinking' ? `<span class="message-file">${escapeHtml(msg.fileName)}</span>` : ''}
          </div>
          <div class="message-content">
            ${formatContent(msg.content)}
          </div>
        </div>
      `;
    }).join('\n');

    const fileChangesHTML = section.fileChanges.length > 0 ? `
      <div class="file-changes">
        <h4>Files Touched</h4>
        <div class="file-list">
          ${section.fileChanges.map(fc => `
            <div class="file-item file-${fc.type}">
              <span class="file-type-badge">${fc.type}</span>
              <span class="file-name">${escapeHtml(fc.fileName)}</span>
            </div>
          `).join('\n')}
        </div>
      </div>
    ` : '';

    const codeBlocksHTML = section.codeBlocks.length > 0 ? `
      <div class="code-blocks-section">
        <h4>Code Blocks</h4>
        ${section.codeBlocks.map(cb => `
          <div class="code-block">
            <div class="code-header">
              <span class="code-lang">${escapeHtml(cb.language)}</span>
              <button class="copy-btn" onclick="copyCode(this)">Copy</button>
            </div>
            <pre><code class="language-${escapeHtml(cb.language)}">${escapeHtml(cb.code)}</code></pre>
          </div>
        `).join('\n')}
      </div>
    ` : '';

    return `
      <section class="conversation-section" id="section-${index}">
        <div class="section-header" onclick="toggleSection(${index})">
          <h3>${escapeHtml(section.title)}</h3>
          <div class="section-meta">
            <span class="meta-item">${section.messages.length} messages</span>
            ${section.fileChanges.length > 0 ? `<span class="meta-item">${section.fileChanges.length} files</span>` : ''}
          </div>
          <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </div>
        <div class="section-content" id="section-content-${index}">
          ${messagesHTML}
          ${fileChangesHTML}
          ${codeBlocksHTML}
        </div>
      </section>
    `;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(parsed.title)} - Conversation Viewer</title>
  <style>
    :root {
      --bg-primary: #0d1117;
      --bg-secondary: #161b22;
      --bg-tertiary: #21262d;
      --text-primary: #f0f6fc;
      --text-secondary: #8b949e;
      --text-muted: #6e7681;
      --border-color: #30363d;
      --accent-blue: #58a6ff;
      --accent-green: #3fb950;
      --accent-orange: #d29922;
      --accent-purple: #a371f7;
      --accent-red: #f85149;
      --user-bg: #1c2128;
      --assistant-bg: #0d1117;
      --tool-bg: #161b22;
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif;
      background-color: var(--bg-primary);
      color: var(--text-primary);
      line-height: 1.6;
      min-height: 100vh;
    }

    /* Header */
    .header {
      background: linear-gradient(135deg, var(--bg-secondary) 0%, var(--bg-tertiary) 100%);
      border-bottom: 1px solid var(--border-color);
      padding: 2rem;
      position: sticky;
      top: 0;
      z-index: 100;
      backdrop-filter: blur(10px);
    }

    .header-content {
      max-width: 1200px;
      margin: 0 auto;
      position: relative;
    }

    .header-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 0.5rem;
    }

    .logo-link {
      display: flex;
      align-items: center;
      text-decoration: none;
    }

    .logo-link:hover {
      opacity: 0.9;
    }

    .logo-img {
      height: 36px;
      width: auto;
    }

    .header-links {
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .community-link {
      color: var(--accent-blue);
      text-decoration: none;
      font-size: 0.875rem;
      padding: 0.375rem 0.75rem;
      border: 1px solid var(--accent-blue);
      border-radius: 6px;
      transition: all 0.2s ease;
    }

    .community-link:hover {
      background: var(--accent-blue);
      color: white;
    }

    .github-link {
      color: var(--text-secondary);
      transition: color 0.2s ease;
    }

    .github-link:hover {
      color: var(--text-primary);
    }

    .github-link svg {
      width: 24px;
      height: 24px;
    }

    .version-badge {
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      color: var(--text-muted);
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-size: 0.75rem;
      font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
      flex-shrink: 0;
    }

    .header h1 {
      font-size: 1.75rem;
      font-weight: 600;
      margin-bottom: 0.5rem;
      background: linear-gradient(90deg, var(--accent-blue), var(--accent-purple));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .header-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 1rem;
      color: var(--text-secondary);
      font-size: 0.875rem;
    }

    .header-meta span {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .header-meta svg {
      width: 16px;
      height: 16px;
    }

    /* Stats Bar */
    .stats-bar {
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border-color);
      padding: 1rem 2rem;
    }

    .stats-content {
      max-width: 1200px;
      margin: 0 auto;
      display: flex;
      flex-wrap: wrap;
      gap: 2rem;
    }

    .stat-item {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .stat-value {
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--accent-blue);
    }

    .stat-label {
      color: var(--text-secondary);
      font-size: 0.875rem;
    }

    /* Navigation */
    .navigation {
      max-width: 1200px;
      margin: 0 auto;
      padding: 1rem 2rem;
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
    }

    .nav-btn {
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      color: var(--text-secondary);
      padding: 0.5rem 1rem;
      border-radius: 6px;
      font-size: 0.875rem;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .nav-btn:hover {
      background: var(--bg-secondary);
      color: var(--text-primary);
      border-color: var(--accent-blue);
    }

    .nav-btn.active {
      background: var(--accent-blue);
      color: white;
      border-color: var(--accent-blue);
    }

    /* Main Content */
    .main-content {
      max-width: 1200px;
      margin: 0 auto;
      padding: 1rem 2rem 4rem;
    }

    /* Sections */
    .conversation-section {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      margin-bottom: 1rem;
      overflow: hidden;
      transition: all 0.3s ease;
    }

    .conversation-section:hover {
      border-color: var(--accent-blue);
    }

    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1rem 1.5rem;
      cursor: pointer;
      background: var(--bg-tertiary);
      transition: background 0.2s ease;
    }

    .section-header:hover {
      background: rgba(88, 166, 255, 0.1);
    }

    .section-header h3 {
      font-size: 1rem;
      font-weight: 500;
      flex: 1;
    }

    .section-meta {
      display: flex;
      gap: 1rem;
      margin-right: 1rem;
    }

    .meta-item {
      font-size: 0.75rem;
      color: var(--text-muted);
      background: var(--bg-primary);
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
    }

    .chevron {
      width: 20px;
      height: 20px;
      transition: transform 0.3s ease;
    }

    .section-content {
      padding: 1.5rem;
      display: none;
    }

    .section-content.expanded {
      display: block;
      animation: fadeIn 0.3s ease;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(-10px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .conversation-section.expanded .chevron {
      transform: rotate(180deg);
    }

    /* Messages */
    .message {
      background: var(--bg-primary);
      border-radius: 8px;
      margin-bottom: 1rem;
      overflow: hidden;
      border: 1px solid var(--border-color);
    }

    .message-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.75rem 1rem;
      border-bottom: 1px solid var(--border-color);
      background: var(--bg-tertiary);
    }

    .message-icon {
      width: 18px;
      height: 18px;
    }

    .message-user .message-icon { color: var(--accent-blue); }
    .message-assistant .message-icon { color: var(--accent-green); }
    .message-tool .message-icon { color: var(--accent-orange); }
    .message-git .message-icon { color: #f14e32; }
    .message-thinking .message-icon { color: #f0883e; }
    .message-system .message-icon { color: var(--accent-purple); }

    .message-label {
      font-weight: 600;
      font-size: 0.875rem;
    }

    .message-user .message-label { color: var(--accent-blue); }
    .message-assistant .message-label { color: var(--accent-green); }
    .message-tool .message-label { color: var(--accent-orange); }
    .message-git .message-label { color: #f14e32; }
    .message-thinking .message-label { color: #f0883e; }

    .message-file {
      font-size: 0.75rem;
      color: var(--text-muted);
      background: var(--bg-primary);
      padding: 0.125rem 0.5rem;
      border-radius: 4px;
      margin-left: auto;
      font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
    }

    .message-content {
      padding: 1rem;
      color: var(--text-secondary);
      font-size: 0.9375rem;
    }

    .search-highlight {
      background-color: #f1c40f;
      color: #000;
      padding: 0.1em 0.2em;
      border-radius: 2px;
    }

    .message-user {
      border-left: 3px solid var(--accent-blue);
    }

    .message-assistant {
      border-left: 3px solid var(--accent-green);
    }

    .message-tool {
      border-left: 3px solid var(--accent-orange);
    }

    .message-git {
      border-left: 3px solid #f14e32;
      background: rgba(241, 78, 50, 0.05);
    }

    .message-thinking {
      border-left: 3px solid #f0883e;
      background: rgba(240, 136, 62, 0.05);
    }

    /* Inline Code */
    .inline-code {
      background: var(--bg-tertiary);
      padding: 0.125rem 0.375rem;
      border-radius: 4px;
      font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
      font-size: 0.875em;
      color: var(--accent-orange);
    }

    /* File Changes */
    .file-changes {
      margin-top: 1.5rem;
      padding: 1rem;
      background: var(--bg-primary);
      border-radius: 8px;
      border: 1px solid var(--border-color);
    }

    .file-changes h4 {
      font-size: 0.875rem;
      color: var(--text-secondary);
      margin-bottom: 0.75rem;
    }

    .file-list {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }

    .file-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      background: var(--bg-tertiary);
      padding: 0.375rem 0.75rem;
      border-radius: 6px;
      font-size: 0.8125rem;
      font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
    }

    .file-type-badge {
      font-size: 0.625rem;
      text-transform: uppercase;
      font-weight: 600;
      padding: 0.125rem 0.375rem;
      border-radius: 3px;
    }

    .file-read .file-type-badge { background: var(--accent-blue); color: white; }
    .file-update .file-type-badge { background: var(--accent-green); color: white; }
    .file-create .file-type-badge { background: var(--accent-purple); color: white; }
    .file-search .file-type-badge { background: var(--accent-orange); color: white; }

    /* Code Blocks */
    .code-blocks-section {
      margin-top: 1.5rem;
    }

    .code-blocks-section h4 {
      font-size: 0.875rem;
      color: var(--text-secondary);
      margin-bottom: 0.75rem;
    }

    .code-block {
      background: var(--bg-primary);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      overflow: hidden;
      margin-bottom: 0.75rem;
    }

    .code-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.5rem 1rem;
      background: var(--bg-tertiary);
      border-bottom: 1px solid var(--border-color);
    }

    .code-lang {
      font-size: 0.75rem;
      color: var(--accent-purple);
      text-transform: uppercase;
      font-weight: 600;
    }

    .copy-btn {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      color: var(--text-secondary);
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-size: 0.75rem;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .copy-btn:hover {
      background: var(--accent-blue);
      color: white;
      border-color: var(--accent-blue);
    }

    .code-block pre {
      margin: 0;
      padding: 1rem;
      overflow-x: auto;
    }

    .code-block code {
      font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
      font-size: 0.8125rem;
      line-height: 1.5;
      color: var(--text-primary);
    }

    /* Search */
    .search-container {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      max-width: 1200px;
      margin: 1rem auto;
      padding: 0 2rem;
    }

    .search-input {
      width: 100%;
      max-width: 400px;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      color: var(--text-primary);
      padding: 0.75rem 1rem;
      border-radius: 8px;
      font-size: 0.875rem;
      outline: none;
      transition: border-color 0.2s ease;
    }

    .search-input:focus {
      border-color: var(--accent-blue);
    }

    .search-icon {
      width: 18px;
      height: 18px;
      color: var(--text-muted);
      flex-shrink: 0;
    }

    /* Responsive */
    @media (max-width: 768px) {
      .header { padding: 1rem; }
      .stats-bar { padding: 0.75rem 1rem; }
      .stats-content { gap: 1rem; }
      .main-content { padding: 1rem; }
      .navigation { padding: 1rem; }
      .search-container { margin: 1rem; max-width: none; padding: 0 1rem; }
      .section-header { padding: 0.75rem 1rem; }
      .section-meta { display: none; }
    }

    /* Accessibility */
    @media (prefers-reduced-motion: reduce) {
      * {
        animation: none !important;
        transition: none !important;
      }
    }

    /* Emoji Bar */
    .emoji-bar {
      max-width: 1200px;
      margin: 0 auto;
      padding: 0.75rem 2rem;
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      align-items: center;
    }

    .emoji-bar-label {
      color: var(--text-secondary);
      font-size: 0.875rem;
      margin-right: 0.5rem;
    }

    .emoji-item {
      display: flex;
      align-items: center;
      gap: 0.25rem;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      padding: 0.375rem 0.625rem;
      border-radius: 20px;
      cursor: pointer;
      transition: all 0.2s ease;
      font-size: 0.875rem;
    }

    .emoji-item:hover {
      background: var(--bg-secondary);
      border-color: var(--accent-blue);
      transform: scale(1.05);
    }

    .emoji-item.active {
      background: var(--accent-blue);
      border-color: var(--accent-blue);
    }

    .emoji-char {
      font-size: 1.125rem;
    }

    .emoji-count {
      color: var(--text-muted);
      font-size: 0.75rem;
      font-weight: 600;
    }

    .emoji-item.active .emoji-count {
      color: white;
    }

    /* Print styles */
    @media print {
      .header { position: static; }
      .nav-btn, .copy-btn, .search-container, .emoji-bar { display: none; }
      .section-content { display: block !important; }
      .conversation-section { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <header class="header">
    <div class="header-content">
      <div class="header-top">
        <a href="https://www.actyra.com" target="_blank" rel="noopener noreferrer" class="logo-link" title="Visit Actyra">
          <img class="logo-img" src="data:image/png;base64,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" alt="Actyra">
        </a>
        <div class="header-links">
          <a href="https://www.skool.com/tech" target="_blank" rel="noopener noreferrer" class="community-link">Join AI Tech Builders Community</a>
          <a href="https://github.com/actyra/conversation-viewer" target="_blank" rel="noopener noreferrer" class="github-link" title="View on GitHub">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
          </a>
          <span class="version-badge">v1.0.12</span>
        </div>
      </div>
      <h1>${escapeHtml(parsed.title)}</h1>
      <div class="header-meta">
        <span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
          ${escapeHtml(parsed.date)}
        </span>
        <span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"></path><path d="M2 17l10 5 10-5"></path><path d="M2 12l10 5 10-5"></path></svg>
          ${escapeHtml(parsed.model)}
        </span>
        ${parsed.projectPath ? `
        <span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
          ${escapeHtml(parsed.projectPath)}
        </span>
        ` : ''}
      </div>
    </div>
  </header>

  <div class="stats-bar">
    <div class="stats-content">
      <div class="stat-item">
        <div class="stat-value">${parsed.statistics.totalMessages}</div>
        <div class="stat-label">Total Messages</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${parsed.sections.length}</div>
        <div class="stat-label">Sections</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${parsed.statistics.filesModified}</div>
        <div class="stat-label">Files Touched</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${parsed.statistics.codeBlocksCount}</div>
        <div class="stat-label">Code Blocks</div>
      </div>
    </div>
  </div>

  <div class="search-container">
    <input type="text" class="search-input" placeholder="Search conversation..." onkeyup="searchConversation(this.value)">
    <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
  </div>

  <nav class="navigation">
    <button class="nav-btn active" onclick="filterMessages('all')">All</button>
    <button class="nav-btn" onclick="filterMessages('user')">User Messages</button>
    <button class="nav-btn" onclick="filterMessages('assistant')">Claude Responses</button>
    <button class="nav-btn" onclick="filterMessages('tool')">Tool Usage</button>
    <button class="nav-btn" onclick="filterMessages('git')">Git Actions</button>
    <button class="nav-btn" onclick="filterMessages('thinking')">Thinking</button>
    <button class="nav-btn" onclick="expandAll()">Expand All</button>
    <button class="nav-btn" onclick="collapseAll()">Collapse All</button>
  </nav>

  ${Object.keys(parsed.statistics.emojiCounts).length > 0 ? `
  <div class="emoji-bar">
    <span class="emoji-bar-label">Emojis:</span>
    ${Object.entries(parsed.statistics.emojiCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([emoji, count]) => `
        <div class="emoji-item" onclick="filterByEmoji('${emoji}')" data-emoji="${emoji}">
          <span class="emoji-char">${emoji}</span>
          <span class="emoji-count">x${count}</span>
        </div>
      `).join('')}
  </div>
  ` : ''}

  <main class="main-content">
    ${sectionsHTML}
  </main>

  <script>
    // Section toggle
    function toggleSection(index) {
      const section = document.getElementById('section-' + index);
      const content = document.getElementById('section-content-' + index);
      section.classList.toggle('expanded');
      content.classList.toggle('expanded');
    }

    // Expand all sections
    function expandAll() {
      document.querySelectorAll('.conversation-section').forEach(section => {
        section.classList.add('expanded');
      });
      document.querySelectorAll('.section-content').forEach(content => {
        content.classList.add('expanded');
      });
    }

    // Collapse all sections
    function collapseAll() {
      document.querySelectorAll('.conversation-section').forEach(section => {
        section.classList.remove('expanded');
      });
      document.querySelectorAll('.section-content').forEach(content => {
        content.classList.remove('expanded');
      });
    }

    // Filter messages
    function filterMessages(type) {
      document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
      event.target.classList.add('active');

      document.querySelectorAll('.message').forEach(msg => {
        if (type === 'all') {
          msg.style.display = 'block';
        } else {
          msg.style.display = msg.classList.contains('message-' + type) ? 'block' : 'none';
        }
      });

      // Auto-expand sections that have visible messages
      document.querySelectorAll('.conversation-section').forEach((section, index) => {
        const content = document.getElementById('section-content-' + index);
        const visibleMessages = content.querySelectorAll('.message:not([style*="display: none"])');
        if (visibleMessages.length > 0 && type !== 'all') {
          section.classList.add('expanded');
          content.classList.add('expanded');
        }
      });
    }

    // Search functionality
    function searchConversation(query) {
      const lowerQuery = query.toLowerCase();

      document.querySelectorAll('.message').forEach(msg => {
        const contentEl = msg.querySelector('.message-content');
        if (!contentEl) return;

        // Store original HTML on first search
        if (!contentEl.dataset.originalHtml) {
          contentEl.dataset.originalHtml = contentEl.innerHTML;
        }

        const text = contentEl.textContent.toLowerCase();
        const matches = !query || text.includes(lowerQuery);
        msg.style.display = matches ? 'block' : 'none';

        if (matches && query) {
          msg.style.backgroundColor = 'rgba(88, 166, 255, 0.1)';
          // Highlight matching text (escape special regex chars)
          const escaped = query.replace(/[-\\/\\\\^$*+?.()|[\\]{}]/g, '\\\\$&');
          const regex = new RegExp('(' + escaped + ')', 'gi');
          contentEl.innerHTML = contentEl.dataset.originalHtml.replace(regex, '<span class="search-highlight">$1</span>');
        } else {
          msg.style.backgroundColor = '';
          // Restore original HTML
          if (contentEl.dataset.originalHtml) {
            contentEl.innerHTML = contentEl.dataset.originalHtml;
          }
        }
      });

      // Auto-expand sections with matches
      if (query) {
        document.querySelectorAll('.conversation-section').forEach((section, index) => {
          const content = document.getElementById('section-content-' + index);
          const visibleMessages = content.querySelectorAll('.message:not([style*="display: none"])');
          if (visibleMessages.length > 0) {
            section.classList.add('expanded');
            content.classList.add('expanded');
          } else {
            section.classList.remove('expanded');
            content.classList.remove('expanded');
          }
        });
      }
    }

    // Copy code to clipboard
    function copyCode(btn) {
      const codeBlock = btn.closest('.code-block');
      const code = codeBlock.querySelector('code').textContent;
      navigator.clipboard.writeText(code).then(() => {
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
      });
    }

    // Filter by emoji
    let activeEmoji = null;
    function filterByEmoji(emoji) {
      // Toggle active state
      document.querySelectorAll('.emoji-item').forEach(item => {
        item.classList.remove('active');
      });

      if (activeEmoji === emoji) {
        // Clicking same emoji clears filter
        activeEmoji = null;
        document.querySelectorAll('.message').forEach(msg => {
          msg.style.display = 'block';
        });
        return;
      }

      activeEmoji = emoji;
      const clickedItem = document.querySelector(\`.emoji-item[data-emoji="\${emoji}"]\`);
      if (clickedItem) clickedItem.classList.add('active');

      // Filter messages containing the emoji
      document.querySelectorAll('.message').forEach(msg => {
        const text = msg.textContent;
        if (text.includes(emoji)) {
          msg.style.display = 'block';
          msg.style.backgroundColor = 'rgba(88, 166, 255, 0.1)';
        } else {
          msg.style.display = 'none';
          msg.style.backgroundColor = '';
        }
      });

      // Auto-expand sections with matches
      document.querySelectorAll('.conversation-section').forEach((section, index) => {
        const content = document.getElementById('section-content-' + index);
        const visibleMessages = content.querySelectorAll('.message:not([style*="display: none"])');
        if (visibleMessages.length > 0) {
          section.classList.add('expanded');
          content.classList.add('expanded');
        } else {
          section.classList.remove('expanded');
          content.classList.remove('expanded');
        }
      });
    }

    // Expand first section by default
    document.addEventListener('DOMContentLoaded', () => {
      toggleSection(0);
    });

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelector('.search-input').value = '';
        searchConversation('');
      }
      if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        document.querySelector('.search-input').focus();
      }
    });
  </script>
</body>
</html>`;
}

// Main execution
async function main() {
  const inputFile = process.argv[2];
  const outputFile = process.argv[3];

  if (!inputFile || !outputFile) {
    console.log('Conversation Transformer');
    console.log('========================');
    console.log('');
    console.log('Usage: npx ts-node src/transformer.ts <input-file> <output-file>');
    console.log('');
    console.log('Arguments:');
    console.log('  input-file   Path to the conversation log file (.txt)');
    console.log('  output-file  Path for the generated HTML file (.html)');
    console.log('');
    console.log('Example:');
    console.log('  npx ts-node src/transformer.ts conversation.txt output.html');
    process.exit(1);
  }

  console.log('Conversation Transformer');
  console.log('========================');
  console.log(`Input: ${inputFile}`);
  console.log(`Output: ${outputFile}`);

  try {
    // Read input file
    const content = fs.readFileSync(inputFile, 'utf-8');
    console.log(`\nRead ${content.length} characters from input file`);

    // Parse conversation
    const parser = new ConversationParser(content);
    const parsed = parser.parse();
    console.log(`\nParsed conversation:`);
    console.log(`  - Sections: ${parsed.sections.length}`);
    console.log(`  - Total messages: ${parsed.statistics.totalMessages}`);
    console.log(`  - User messages: ${parsed.statistics.userMessages}`);
    console.log(`  - Assistant messages: ${parsed.statistics.assistantMessages}`);
    console.log(`  - Files touched: ${parsed.statistics.filesModified}`);
    console.log(`  - Code blocks: ${parsed.statistics.codeBlocksCount}`);

    // Generate HTML
    const html = generateHTML(parsed);
    console.log(`\nGenerated ${html.length} characters of HTML`);

    // Write output file
    fs.writeFileSync(outputFile, html, 'utf-8');
    console.log(`\nSuccessfully wrote output to: ${outputFile}`);
    console.log('\nOpen the HTML file in a browser to view the interactive conversation!');

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
