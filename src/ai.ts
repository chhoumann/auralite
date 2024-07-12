import type { EditorState } from "@/actions/Action";
import type OVSPlugin from "@/main";
import { removeWhitespace } from "@/utils";
import type Instructor from "@instructor-ai/instructor";
import type OpenAI from "openai";
import type { ClientOptions } from "openai";
import type { ChatCompletionMessageParam } from "openai/resources";
import type { Stream } from "openai/streaming";
import { z } from "zod";
import type { ContextBuilder } from "./ContextBuilder";
import { logger } from "./logging";
import { TypedEvents } from "./types/TypedEvents";

interface AIManagerEvents {
	processingStarted: () => void;
	transcriptionComplete: (transcription: string) => void;
	actionPlanned: (action: string, contexts: string[]) => void;
	actionExecutionStarted: (action: string) => void;
	actionExecutionComplete: (action: string) => void;
	processingComplete: () => void;
	error: (error: Error) => void;
}

export class AIManager extends TypedEvents<AIManagerEvents> {
	abortController: AbortController | null = null;

	constructor(
		private plugin: OVSPlugin,
		private actionIds: string[],
		private oai: OpenAI,
		private instructorClient: ReturnType<typeof Instructor>,
		private contextBuilder: ContextBuilder,
	) {
		super();
	}

	getOpenAI(): OpenAI {
		return this.oai;
	}

	getInstructorClient(): ReturnType<typeof Instructor> {
		return this.instructorClient;
	}

	async transcribeAudio(audioData: {
		buffer: ArrayBuffer;
		mimeType: string;
	}): Promise<string> {
		this.abortController = new AbortController();

		try {
			const response = await this.oai.audio.transcriptions.create(
				{
					file: new File([audioData.buffer], `audio.${audioData.mimeType}`),
					model: "whisper-1",
				},
				{ signal: this.abortController.signal },
			);

			this.trigger("transcriptionComplete", response.text);

			return response.text;
		} catch (error: unknown) {
			if (error instanceof Error && error.name === "AbortError") {
				logger.error("Audio transcription was cancelled", { error });
				throw new Error("Audio transcription cancelled");
			}
			logger.error("Error transcribing audio", { error });
			throw new Error("Failed to transcribe audio");
		}
	}

	async executeAction(
		action: string,
		initialInput: Map<string, unknown>,
		editorState: Partial<EditorState>,
	) {
		this.abortController = new AbortController();
		const context = this.contextBuilder.build(this, initialInput, editorState);
		context.abortSignal = this.abortController.signal;

		try {
			await this.plugin.actionManager.executeAction(action, context);
		} catch (error: unknown) {
			if (error instanceof Error && error.name === "AbortError") {
				logger.error("Action was cancelled", { error });
			} else {
				throw error;
			}
		}
	}

	async run(userInput: string, editorState: Partial<EditorState>) {
		this.trigger("processingStarted");

		try {
			const actionsList = this.actionIds.map(
				(actionId) =>
					` - ${actionId}: ${this.plugin.actionManager?.getAction(actionId)?.description}`,
			);
			const actionsPrompt = removeWhitespace(
				`The action to take. Here are the available actions:\n${actionsList.join("\n")}`,
			);

			const possibleContexts = {
				currentFile: "The current file, including name and contents",
				currentLine: "The current line",
				currentSelection: "The current selection",
			} as const;

			type PossibleContexts = keyof typeof possibleContexts;

			const actionSchema = z.object({
				action: z
					.enum(this.actionIds as [string, ...string[]])
					.describe(actionsPrompt),
				necessaryContexts: z
					.array(
						z.enum(
							Object.keys(possibleContexts) as [
								PossibleContexts,
								...PossibleContexts[],
							],
						),
					)
					.optional()
					.describe(
						`The necessary context to execute the action.\nOnly include the context that is necessary to execute the action.\nHere are the available contexts:\n${Object.entries(
							possibleContexts,
						)
							.map(([key, value]) => `- ${key}: ${value}`)
							.join("\n")}`,
					),
			});

			const actionResult = await this.createInstructorChatCompletion(
				actionSchema,
				[
					{
						role: "system",
						content: "You are an assistant that can execute actions",
					},
					{
						role: "user",
						content: userInput,
					},
				],
			);

			this.trigger(
				"actionPlanned",
				actionResult.action,
				actionResult.necessaryContexts ?? [],
			);

			const input = new Map();

			const necessaryContexts = actionResult.necessaryContexts ?? [];
			const validContexts = necessaryContexts.filter(
				(context) => context in editorState,
			);

			for (const context of validContexts) {
				input.set(context, editorState[context]);
			}

			input.set("action", actionResult.action);
			input.set(
				"actionDescription",
				this.plugin.actionManager.getAction(actionResult.action)?.description,
			);
			input.set("userInput", userInput);

			logger.debug("input", { input });

			this.trigger("actionExecutionStarted", actionResult.action);
			await this.executeAction(actionResult.action, input, editorState);
			this.trigger("actionExecutionComplete", actionResult.action);

			this.trigger("processingComplete");
		} catch (error) {
			this.trigger(
				"error",
				error instanceof Error ? error : new Error(String(error)),
			);
		}
	}

	async createInstructorChatCompletion<TSchema extends z.AnyZodObject>(
		schema: TSchema,
		messages: Array<ChatCompletionMessageParam>,
	) {
		this.abortController = new AbortController();
		try {
			const response = await this.instructorClient.chat.completions.create(
				{
					messages,
					model: this.plugin.settings.OPENAI_MODEL,
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
				logger.error("Chat completion was cancelled", { error });
				throw new Error("Chat completion cancelled");
			}
			logger.error("Error creating chat completion", { error });
			throw new Error("Failed to create chat completion");
		}
	}

	async createInstructorChatCompletionStream<TSchema extends z.AnyZodObject>(
		schema: TSchema,
		messages: Array<ChatCompletionMessageParam>,
	): Promise<Stream<z.infer<TSchema>>> {
		this.abortController = new AbortController();
		try {
			const stream = await this.instructorClient.chat.completions.create(
				{
					messages,
					model: this.plugin.settings.OPENAI_MODEL,
					response_model: {
						schema: schema,
						name: "User",
					},
					stream: true,
				},
				{ signal: this.abortController.signal },
			);

			//@ts-ignore: don't want to type this rn
			return stream;
		} catch (error: unknown) {
			if (error instanceof Error && error.name === "AbortError") {
				logger.error("Chat completion stream was cancelled", { error });
				throw new Error("Chat completion stream cancelled");
			}
			logger.error("Error creating chat completion stream", { error });
			throw new Error("Failed to create chat completion stream");
		}
	}

	async createOpenAIChatCompletion(
		messages: Array<ChatCompletionMessageParam>,
		options?: Partial<ClientOptions>,
	) {
		this.abortController = new AbortController();
		try {
			return await this.oai.chat.completions.create(
				{
					messages,
					model: this.plugin.settings.OPENAI_MODEL,
					...options,
				},
				{ signal: this.abortController.signal },
			);
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") {
				logger.error("Chat completion was cancelled", { error });
				throw new Error("Chat completion cancelled");
			}
			logger.error("Error creating chat completion", { error });
			throw new Error("Failed to create chat completion");
		}
	}

	async createOpenAIChatCompletionStream(
		messages: Array<ChatCompletionMessageParam>,
		options?: Partial<ClientOptions>,
	) {
		this.abortController = new AbortController();
		try {
			return await this.oai.chat.completions.create(
				{
					messages,
					model: this.plugin.settings.OPENAI_MODEL,
					stream: true,
					...options,
				},
				{ signal: this.abortController.signal },
			);
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") {
				logger.error("Chat completion stream was cancelled", { error });
				throw new Error("Chat completion stream cancelled");
			}
			logger.error("Error creating chat completion stream", { error });
			throw new Error("Failed to create chat completion stream");
		}
	}

	cancel() {
		this.abortController?.abort();
		this.abortController = null;
	}
}
