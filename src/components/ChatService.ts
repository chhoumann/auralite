import type { AIManager } from "@/ai";
import type AuralitePlugin from "@/main";
import { logger } from "@/logging";
import { TypedEvents } from "@/types/TypedEvents";
import type { ChatView } from "./ChatView";
import type { ChatCompletionMessageParam } from "openai/resources";
import { z } from "zod";

interface ChatServiceEvents {
	messageReceived: (message: {
		role: "user" | "assistant" | "action";
		content: string;
		actionId?: string;
		context?: string;
	}) => void;
	processingStarted: () => void;
	processingComplete: () => void;
	error: (error: Error) => void;
}

interface ChatMessage {
	role: "user" | "assistant" | "action";
	content: string;
	actionId?: string;
	context?: string;
}

export class ChatService extends TypedEvents<ChatServiceEvents> {
	private messages: ChatMessage[] = [];
	private actionMessageIndex: Map<string, number> = new Map();
	private plugin: AuralitePlugin;
	private aiManager: AIManager;
	private view: ChatView | null = null;

	constructor(plugin: AuralitePlugin) {
		super();
		this.plugin = plugin;
		this.aiManager = plugin.getAIManager();
		// Listen to AI manager events so voice interactions and action status are reflected in the chat
		this.initializeAIManagerListeners();
	}

	/**
	 * Attach listeners to the AIManager so that voice-driven interactions and action status updates
	 * automatically appear in the chat timeline. This keeps the chat history in sync with everything
	 * that happens during a session, regardless of whether the interaction originated from typing or
	 * speaking.
	 */
	private initializeAIManagerListeners() {
		// User finished speaking – add their transcription as a user message
		this.aiManager.on("transcriptionComplete", (transcription: string) => {
			logger.debug("Adding transcription to chat", { transcription });
			this.addMessage("user", transcription);
		});

		// Show a typing indicator while the assistant is thinking
		this.aiManager.on("processingStarted", () => {
			this.trigger("processingStarted");
			this.view?.startProcessing();
		});

		this.aiManager.on("processingComplete", () => {
			this.trigger("processingComplete");
			this.view?.endProcessing();
		});

		// High level action lifecycle updates
		this.aiManager.on("actionPlanned", (action: string, contexts: string[]) => {
			const rawDesc = this.plugin.actionManager.getAction(action)?.description;
			const displayName = rawDesc ? rawDesc.split("(")[0].trim() : action;
			const id = `${action}-${Date.now()}`;
			const content = `⚡ ${displayName} – in progress`;
			this.addMessage("action", content, id, JSON.stringify(contexts, null, 2));
			// Store index for later update
			this.actionMessageIndex.set(action, this.messages.length - 1);
		});

		// Remove separate executing indicator
		this.aiManager.on("actionExecutionStarted", () => {});

		this.aiManager.on("actionExecutionComplete", async (action: string) => {
			// Update the existing action line
			const idx = this.actionMessageIndex.get(action);
			if (idx !== undefined) {
				const line = this.messages[idx];
				if (line) {
					const rawDesc2 =
						this.plugin.actionManager.getAction(action)?.description;
					const displayName = rawDesc2 ? rawDesc2.split("(")[0].trim() : action;
					line.content = `✔ ${displayName} – done`;
					this.view?.refresh();
				}
			}

			// Generate a summary message for the user about what was done
			try {
				const summarySchema = z.object({
					summary: z
						.string()
						.describe(
							"A concise, user-facing summary of what was just done. Use natural language, not code or markdown.",
						),
				});
				const chatHistory = this.getMessages().map((m) => {
					const role = m.role === "user" ? "user" : "assistant";
					return {
						role,
						content: m.content,
					} as ChatCompletionMessageParam;
				});
				const summaryPrompt: ChatCompletionMessageParam[] = [
					{
						role: "system",
						content:
							"You are Auralite, a helpful assistant integrated in Obsidian. In one friendly sentence, tell the user what *we* just accomplished together based on the most recently completed action.",
					},
					...chatHistory,
					{
						role: "user",
						content:
							"Summarize in one friendly sentence what we just accomplished.",
					},
				];
				const summaryResp =
					(await this.aiManager.createInstructorChatCompletion(
						summarySchema,
						summaryPrompt,
					)) as z.infer<typeof summarySchema>;
				if (summaryResp && typeof summaryResp.summary === "string") {
					this.addMessage("assistant", summaryResp.summary);
				}
			} catch (e) {
				logger.error("Failed to generate action summary", { error: e });
			}
		});

		// Surface errors directly in the chat so users know what happened
		this.aiManager.on("error", (error: Error) => {
			this.addMessage("assistant", `⚠️ An error occurred: ${error.message}`);
		});
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

			// Build chat history in the format expected by OpenAI
			const historyMessages: ChatCompletionMessageParam[] = this.messages.map(
				(m) => {
					const role = m.role === "user" ? "user" : "assistant"; // map 'assistant' and 'action' to assistant
					return {
						role,
						content: m.content,
					} as ChatCompletionMessageParam;
				},
			);

			const chatMessages: ChatCompletionMessageParam[] = [
				{
					role: "system",
					content:
						"You are Auralite, a helpful AI assistant for Obsidian. Provide concise, clear, and helpful responses. When referring to actions or functionality related to the plugin, explain how they can be used.",
				},
				...historyMessages,
			];

			// Get AI response
			const response = (await this.aiManager.createInstructorChatCompletion(
				responseSchema,
				chatMessages,
			)) as z.infer<typeof responseSchema>;

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

	private addMessage(
		role: "user" | "assistant" | "action",
		content: string,
		actionId?: string,
		context?: string,
	) {
		const message: ChatMessage = { role, content, actionId, context };
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
