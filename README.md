# Auralite

[![GitHub release](https://img.shields.io/github/release/chhoumann/auralite.svg)](https://github.com/chhoumann/auralite/releases)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Auralite** is an AI-powered voice assistant plugin for Obsidian that transforms how you interact with your notes. Speak naturally to create content, transcribe thoughts, and manage your knowledge base hands-free.

## ✨ Key Features

- **🎙️ Voice-to-Text Transcription**: Convert speech to formatted text with multiple OpenAI models
- **🤖 AI Assistant**: Create notes, write content, and edit existing notes using voice commands
- **📝 Smart Formatting**: Automatic Markdown formatting with Obsidian-style links and LaTeX equations
- **🔇 Silence Detection**: Automatically stop recording after periods of silence
- **🎯 Context-Aware**: AI understands your vault structure and note relationships

## 🚀 Quick Start

### Installation

#### Option 1: BRAT (Recommended)
1. Install [BRAT](https://tfthacker.com/brat-quick-guide) from Obsidian's Community Plugins
2. Open command palette → `BRAT: Add a beta plugin for testing`
3. Enter `chhoumann/auralite`
4. Enable the plugin in Settings → Community Plugins

#### Option 2: Manual Installation
1. Download `manifest.json`, `main.js`, and `styles.css` from the [latest release](https://github.com/chhoumann/auralite/releases)
2. Place files in `<vault>/.obsidian/plugins/auralite/`
3. Enable the plugin in Settings → Community Plugins

### Setup
1. Open Obsidian Settings → Auralite
2. Enter your OpenAI API key
3. Choose your preferred transcription model (whisper-1, gpt-4o-transcribe, or gpt-4o-mini-transcribe)

## 🎯 Core Commands

### Voice Transcription
**Command**: `Transcribe`
- Speak your thoughts and get formatted text at your cursor
- Automatic punctuation and paragraph breaks
- Optionally save the original recording as a vault attachment embedded after the transcript
- Supports multiple languages and accents

### AI Assistant
**Command**: `Toggle AI Assistant Listening`
- **Create Notes**: "Create a new note about quantum physics"
- **Write Content**: "Write a summary of today's meeting"
- **Edit Text**: "Make the second paragraph more concise"
- **Add Sections**: "Add a conclusion to this note"

### Utility
**Command**: `Cancel Ongoing Operation`
- Stop any AI task in progress

## 🔧 Transcription Models

Choose the best model for your needs:

| Model | Best For | Characteristics |
|-------|----------|-----------------|
| **whisper-1** | Short English audio, speed | Fastest, most reliable, open-source |
| **gpt-4o-transcribe** | Non-English languages, accuracy | Better accuracy, slower, newer model |
| **gpt-4o-mini-transcribe** | Cost-effective transcription | Lightweight, affordable, good for bulk use |

## 💡 Usage Tips

- **Be Specific**: Give clear instructions like "Add a bullet list of project goals"
- **Use Context**: Reference selected text or current note content
- **Markdown Aware**: Ask for formatted content, headers, lists, and equations
- **Math Support**: Request LaTeX equations between `$$` symbols
- **Template Integration**: Set up note templates in settings for consistent formatting

## 🛠️ Development

### Build Commands
```bash
# Development with watch mode
bun ./esbuild.config.mjs

# Production build
bun ./esbuild.config.mjs production

# Type checking and linting
bun run check
```

### Project Structure
```
src/
├── main.ts              # Plugin entry point
├── commands.ts          # Obsidian commands
├── ai.ts               # AI integration
├── AudioRecorder.ts    # Voice recording
├── actions/            # AI actions (create, write, edit)
├── tasks/              # Background tasks
└── components/         # UI components
```

### Contributing
1. Fork the repository
2. Create a feature branch: `git checkout -b feat/new-feature`
3. Make changes and test thoroughly
4. Run quality checks: `bun run check`
5. Submit a pull request

## 📊 Requirements

- **Obsidian**: Version 1.6.5 or higher
- **OpenAI API Key**: Required for AI features
- **Microphone**: For voice input
- **Internet Connection**: For AI processing

## 📚 Documentation

Full documentation is available at [auralite.obsidian.guide](https://auralite.obsidian.guide)

## 🤝 Support

- **Issues**: [GitHub Issues](https://github.com/chhoumann/auralite/issues)
- **Discussions**: [GitHub Discussions](https://github.com/chhoumann/auralite/discussions)
- **Twitter**: [@chrisbbh](https://twitter.com/chrisbbh)
