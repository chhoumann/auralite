import Instructor from "@instructor-ai/instructor";
import OpenAI from "openai";
import { z } from "zod";
import type { ActionContext } from "./actions/Action";
import type OVSPlugin from "./main";

export class AIManager {
	private oai: OpenAI;
	private client: ReturnType<typeof Instructor>;
	private plugin!: OVSPlugin;
	private actionIds: string[];
	private abortController: AbortController | null = null;

	constructor(plugin: OVSPlugin, actionIDs: string[]) {
		this.plugin = plugin;
		this.oai = new OpenAI({
			apiKey: plugin.settings.OPENAI_API_KEY,
			dangerouslyAllowBrowser: true,
		});

		this.client = Instructor({
			client: this.oai,
			mode: "TOOLS",
		});

		this.actionIds = actionIDs;
	}

	async transcribeAudio(audioBuffer: ArrayBuffer): Promise<string> {
		this.abortController = new AbortController();
		try {
			const response = await this.oai.audio.transcriptions.create(
				{
					file: new File([audioBuffer], "audio.wav", { type: "audio/wav" }),
					model: "whisper-1",
				},
				{ signal: this.abortController.signal },
			);

			return response.text;
		} catch (error: unknown) {
			if (error instanceof Error && error.name === "AbortError") {
				console.log("Audio transcription was cancelled");
				throw new Error("Audio transcription cancelled");
			}
			console.error("Error transcribing audio:", error);
			throw new Error("Failed to transcribe audio");
		}
	}

	async executeAction(action: string, initialInput: Map<string, unknown>) {
		this.abortController = new AbortController();

		const context: ActionContext = {
			app: this.plugin.app,
			plugin: this.plugin,
			oai: this.oai,
			ai: this,
			client: this.client,
			results: initialInput,
			abortSignal: this.abortController.signal,
		};

		try {
			await this.plugin.actionManager.executeAction(action, context);
		} catch (error: unknown) {
			if (error instanceof Error && error.name === "AbortError") {
				console.log("Action was cancelled");
			} else {
				throw error;
			}
		}
	}

	async run(userInput: string) {
		const actionSchema = z.object({
			action: z
				.enum(this.actionIds as [string, ...string[]])
				.describe("The action to take"),
		});

		const actionResult = await this.createChatCompletion(actionSchema, [
			{
				role: "system",
				content: "You are an assistant that can execute actions",
			},
			{
				role: "user",
				content: userInput,
			},
		]);

		console.log(actionResult);

		const input = new Map();
		input.set("action", actionResult.action);
		input.set("userInput", userInput);

		this.executeAction(actionResult.action, input);
	}

	async createChatCompletion<TSchema extends z.AnyZodObject>(
		schema: TSchema,
		messages: Array<{ role: string; content: string }>,
	) {
		this.abortController = new AbortController();
		try {
			const response = await this.client.chat.completions.create(
				{
					messages,
					model: "gpt-4",
					response_model: {
						schema: schema,
						name: "User",
					},
				},
				{ signal: this.abortController.signal },
			);

			return response;
		} catch (error: unknown) {
			if (error instanceof Error && error.name === "AbortError") {
				console.log("Chat completion was cancelled");
				throw new Error("Chat completion cancelled");
			}
			console.error("Error creating chat completion:", error);
			throw new Error("Failed to create chat completion");
		}
	}

	cancelOngoingOperation() {
		if (this.abortController) {
			this.abortController.abort();
			this.abortController = null;
		}
	}
}
