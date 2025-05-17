import { ItemView, MarkdownRenderer, setIcon } from "obsidian";
import type { WorkspaceLeaf } from "obsidian";
import type AuralitePlugin from "../main";
import type { ChatService } from "./ChatService";

export const CHAT_VIEW_TYPE = "auralite-chat-view";

export class ChatView extends ItemView {
	private messages: { role: "user" | "assistant"; content: string }[] = [];
	private inputEl: HTMLInputElement | null = null;
	private messagesEl: HTMLDivElement | null = null;
	private isProcessing: boolean = false;
	private plugin?: AuralitePlugin;
	private chatService?: ChatService;

	constructor(leaf: WorkspaceLeaf, plugin?: AuralitePlugin) {
		super(leaf);
		if (plugin) this.plugin = plugin;
	}

	override getViewType() {
		return CHAT_VIEW_TYPE;
	}

	override getDisplayText() {
		return "Auralite Chat";
	}

	override async onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("auralite-chat-view");

		// Header with clear button only
		const header = contentEl.createEl("div", { cls: "auralite-chat-header" });
		const clearBtn = header.createEl("button", {
			cls: "auralite-chat-clear-btn",
			attr: { title: "Clear chat history" },
		});
		setIcon(clearBtn, "trash");
		clearBtn.onclick = () => this.handleClear();

		// Message list
		this.messagesEl = contentEl.createEl("div", {
			cls: "auralite-chat-messages",
		});
		this.renderMessages();

		// Input area
		const inputContainer = contentEl.createEl("div", {
			cls: "auralite-chat-input-container",
		});
		this.inputEl = inputContainer.createEl("input", {
			cls: "auralite-chat-input",
			attr: { type: "text", placeholder: "Type a message..." },
		});
		const sendBtn = inputContainer.createEl("button", {
			cls: "auralite-chat-send-btn",
		});
		setIcon(sendBtn, "arrow-right");
		sendBtn.onclick = () => this.handleSend();
		this.inputEl.addEventListener("keydown", (e) => {
			if (e.key === "Enter") this.handleSend();
		});
	}

	private renderMessages() {
		if (!this.messagesEl) return;
		this.messagesEl.empty();

		for (let i = 0; i < this.messages.length; i++) {
			const msg = this.messages[i];
			const isActionIndicator =
				msg.role === "assistant" &&
				/^(Planning to execute|Executing|Completed|⚠️ An error occurred:)/.test(
					msg.content.trim(),
				);

			if (isActionIndicator) {
				const indicator = this.messagesEl.createEl("div", {
					cls: "auralite-chat-action-indicator",
				});
				MarkdownRenderer.renderMarkdown(msg.content, indicator, "", this);
				continue;
			}

			const msgEl = this.messagesEl.createEl("div", {
				cls: `auralite-chat-message auralite-chat-message-${msg.role}`,
			});
			if (msg.role === "assistant") {
				MarkdownRenderer.renderMarkdown(msg.content, msgEl, "", this);
			} else {
				msgEl.setText(msg.content);
			}
		}

		// Add typing indicator if processing
		if (this.isProcessing) {
			this.addTypingIndicator();
		}

		// Auto scroll to bottom
		this.scrollToBottom();
	}

	private addTypingIndicator() {
		if (!this.messagesEl) return;

		const indicatorEl = this.messagesEl.createEl("div", {
			cls: "auralite-chat-typing-indicator",
		});

		// Create three dots for the typing animation
		for (let i = 0; i < 3; i++) {
			indicatorEl.createEl("div", { cls: "auralite-chat-typing-dot" });
		}
	}

	private scrollToBottom() {
		if (this.messagesEl) {
			this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
		}
	}

	private async handleSend() {
		if (!this.inputEl || this.isProcessing) return;

		const value = this.inputEl.value.trim();
		if (!value) return;

		// Clear input immediately for better UX
		this.inputEl.value = "";

		// If chat service is available, use it
		if (this.chatService) {
			await this.chatService.sendMessage(value);
			return;
		}

		// Fallback to basic message display if no service
		this.messages.push({ role: "user", content: value });
		this.isProcessing = true;
		this.renderMessages();

		// Simulate response for when no chat service is available
		setTimeout(() => {
			this.messages.push({
				role: "assistant",
				content:
					"This is a placeholder response. I'll be integrated with the actual AI assistant soon!",
			});
			this.isProcessing = false;
			this.renderMessages();
		}, 1500);
	}

	// Method to be called when integrating with actual AI
	public async addMessage(role: "user" | "assistant", content: string) {
		this.messages.push({ role, content });
		this.renderMessages();
	}

	// Start the AI processing state
	public startProcessing() {
		this.isProcessing = true;
		this.renderMessages();
	}

	// End the AI processing state
	public endProcessing() {
		this.isProcessing = false;
		this.renderMessages();
	}

	// Get all messages for context
	public getMessages() {
		return [...this.messages];
	}

	// Clear all messages
	public clearMessages() {
		this.messages = [];
		this.renderMessages();
	}

	// Set the chat service for this view
	public setChatService(chatService: ChatService) {
		this.chatService = chatService;
	}

	private handleClear() {
		if (this.chatService) {
			this.chatService.clearMessages();
		} else {
			this.clearMessages();
		}
	}

	override async onClose() {
		this.contentEl.empty();
		this.inputEl = null;
		this.messagesEl = null;
	}
}
