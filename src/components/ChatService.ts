import type { AIManager } from "@/ai";
import type AuralitePlugin from "@/main";
import { logger } from "@/logging";
import { TypedEvents } from "@/types/TypedEvents";
import type { ChatView } from "./ChatView";
import type { ChatCompletionMessageParam } from "openai/resources";
import { z } from "zod";

interface ChatServiceEvents {
	messageReceived: (message: {
		role: "user" | "assistant";
		content: string;
	}) => void;
	processingStarted: () => void;
	processingComplete: () => void;
	error: (error: Error) => void;
}

export class ChatService extends TypedEvents<ChatServiceEvents> {
	private messages: { role: "user" | "assistant"; content: string }[] = [];
	private plugin: AuralitePlugin;
	private aiManager: AIManager;
	private view: ChatView | null = null;

	constructor(plugin: AuralitePlugin) {
		super();
		this.plugin = plugin;
		this.aiManager = plugin.getAIManager();
	}

	public setView(view: ChatView) {
		this.view = view;
		// Sync any existing messages to the view
		if (this.messages.length > 0) {
			for (const message of this.messages) {
				this.view.addMessage(message.role, message.content);
			}
		}
	}

	public async sendMessage(message: string) {
		if (!message.trim()) return;

		// Add user message
		this.addMessage("user", message);

		try {
			// Start processing
			this.trigger("processingStarted");
			if (this.view) {
				this.view.startProcessing();
			}

			// Define a schema for chat responses
			const responseSchema = z.object({
				response: z
					.string()
					.describe("A helpful, concise response to the user's message"),
			});

			// Convert message history to OpenAI chat format
			const chatMessages: ChatCompletionMessageParam[] = [
				{
					role: "system",
					content:
						"You are Auralite, a helpful AI assistant for Obsidian. Provide concise, clear, and helpful responses. When referring to actions or functionality related to the plugin, explain how they can be used.",
				},
				...this.messages.map((m) => ({
					role: m.role === "user" ? "user" : "assistant",
					content: m.content,
				})),
			];

			// Get AI response
			const response = await this.aiManager.createInstructorChatCompletion(
				responseSchema,
				chatMessages,
			);

			// Add assistant message
			this.addMessage("assistant", response.response);
		} catch (error) {
			logger.error("Error in chat service", { error });
			if (error instanceof Error) {
				this.trigger("error", error);
			} else {
				this.trigger("error", new Error("Unknown error in chat service"));
			}
		} finally {
			this.trigger("processingComplete");
			if (this.view) {
				this.view.endProcessing();
			}
		}
	}

	private addMessage(role: "user" | "assistant", content: string) {
		const message = { role, content };
		this.messages.push(message);
		this.trigger("messageReceived", message);

		// Also update the view if it exists
		if (this.view) {
			this.view.addMessage(role, content);
		}
	}

	public getMessages() {
		return [...this.messages];
	}

	public clearMessages() {
		this.messages = [];
		if (this.view) {
			this.view.clearMessages();
		}
	}
}
