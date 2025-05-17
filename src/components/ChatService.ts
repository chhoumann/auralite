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
		this.aiManager.on("actionPlanned", (action: string) => {
			this.addMessage("assistant", `Planning to execute **${action}** …`);
		});

		this.aiManager.on("actionExecutionStarted", (action: string) => {
			this.addMessage("assistant", `Executing **${action}** …`);
		});

		this.aiManager.on("actionExecutionComplete", async (action: string) => {
			this.addMessage("assistant", `Completed **${action}**.`);

			// Generate a summary message for the user about what was done
			try {
				const summarySchema = z.object({
					summary: z
						.string()
						.describe(
							"A concise, user-facing summary of what was just done. Use natural language, not code or markdown.",
						),
				});
				const chatHistory = this.getMessages().map((m) => ({
					role: m.role,
					content: m.content,
				})) as ChatCompletionMessageParam[];
				const summaryPrompt: ChatCompletionMessageParam[] = [
					{
						role: "system",
						content:
							"You are Auralite, an assistant that summarizes actions for the user in a friendly, concise way. Only summarize the most recent action that was just completed.",
					},
					...chatHistory,
					{
						role: "user",
						content:
							"Please summarize for the user what was just done in a single, friendly sentence.",
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
				(m) =>
					({
						role: m.role,
						content: m.content,
					}) as ChatCompletionMessageParam,
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
