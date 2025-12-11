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

      // Detect thinking blocks (lines with thinking indicators)
      if (line.includes('thinking') || line.includes('Thinking') || line.match(/^\s*<thinking>/) || line.match(/^\s*\[thinking\]/i)) {
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

    // Emoji regex pattern - matches most common emojis
    const emojiRegex = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2300}-\u{23FF}]|[\u{2B50}]|[\u{1FA00}-\u{1FAFF}]|[\u{1F900}-\u{1F9FF}]/gu;

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
            ${msg.fileName ? `<span class="message-file">${escapeHtml(msg.fileName)}</span>` : ''}
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

    .logo-svg {
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
      position: relative;
      max-width: 400px;
      margin: 1rem 2rem;
    }

    .search-input {
      width: 100%;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      color: var(--text-primary);
      padding: 0.75rem 1rem 0.75rem 2.5rem;
      border-radius: 8px;
      font-size: 0.875rem;
      outline: none;
      transition: border-color 0.2s ease;
    }

    .search-input:focus {
      border-color: var(--accent-blue);
    }

    .search-icon {
      position: absolute;
      left: 0.75rem;
      top: 50%;
      transform: translateY(-50%);
      width: 18px;
      height: 18px;
      color: var(--text-muted);
    }

    /* Responsive */
    @media (max-width: 768px) {
      .header { padding: 1rem; }
      .stats-bar { padding: 0.75rem 1rem; }
      .stats-content { gap: 1rem; }
      .main-content { padding: 1rem; }
      .navigation { padding: 1rem; }
      .search-container { margin: 1rem; max-width: none; }
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
          <svg class="logo-svg" viewBox="0 0 200 50" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M5 45L25 5H35L55 45H45L41 35H19L15 45H5ZM22 27H38L30 10L22 27Z" fill="#2D4A5E"/>
            <path d="M18 35C18 35 25 20 35 12C45 4 55 8 55 8" stroke="#E86A33" stroke-width="4" stroke-linecap="round" fill="none"/>
            <path d="M60 45V8H68V45H60ZM75 45V8H83V45H75ZM75 28H68V22H83V28H75Z" fill="#2D4A5E"/>
            <text x="62" y="38" font-family="Arial, sans-serif" font-size="28" font-weight="bold" fill="#2D4A5E">CTYRA</text>
          </svg>
        </a>
        <div class="header-links">
          <a href="https://www.skool.com/tech" target="_blank" rel="noopener noreferrer" class="community-link">Join AI Tech Builders Community</a>
          <a href="https://github.com/actyra/conversation-viewer" target="_blank" rel="noopener noreferrer" class="github-link" title="View on GitHub">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
          </a>
          <span class="version-badge">v1.0.7</span>
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
    <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
    <input type="text" class="search-input" placeholder="Search conversation..." onkeyup="searchConversation(this.value)">
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
        const text = msg.textContent.toLowerCase();
        const matches = !query || text.includes(lowerQuery);
        msg.style.display = matches ? 'block' : 'none';
        if (matches && query) {
          msg.style.backgroundColor = 'rgba(88, 166, 255, 0.1)';
        } else {
          msg.style.backgroundColor = '';
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
