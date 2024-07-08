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
		try {
			const response = await this.oai.audio.transcriptions.create({
				file: new File([audioBuffer], "audio.wav", { type: "audio/wav" }),
				model: "whisper-1",
			});

			return response.text;
		} catch (error) {
			console.error("Error transcribing audio:", error);
			throw new Error("Failed to transcribe audio");
		}
	}

	async executeAction(action: string, initialInput: Map<string, unknown>) {
		const context: ActionContext = {
			app: this.plugin.app,
			plugin: this.plugin,
			oai: this.oai,
			ai: this,
			client: this.client,
			results: initialInput,
		};

		this.plugin.actionManager.executeAction(action, context);
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
		try {
			const response = await this.client.chat.completions.create({
				messages,
				model: "gpt-4o",
				response_model: {
					schema: schema,
					name: "User",
				},
			});

			return response;
		} catch (error) {
			console.error("Error creating chat completion:", error);
			throw new Error("Failed to create chat completion");
		}
	}
}
