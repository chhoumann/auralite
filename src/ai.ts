import type { EditorState } from "@/actions/Action";
import type AuralitePlugin from "@/main";
import { removeWhitespace } from "@/utils";
import type Instructor from "@instructor-ai/instructor";
import type OpenAI from "openai";
import type { ClientOptions } from "openai";
import type { ChatCompletionMessageParam } from "openai/resources";
import type { Stream } from "openai/streaming";
import { z } from "zod";
import type { ContextBuilder } from "./ContextBuilder";
import { hasUsage, isActionResponse } from "./api_types";
import { logger } from "./logging";
import { telemetry } from "./telemetry";
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
		private plugin: AuralitePlugin,
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

			// Record transcription usage (estimate based on text length since Whisper API doesn't provide token counts)
			const estimatedTokens = Math.ceil(response.text.length / 4); // ~4 chars per token as a rough estimate
			telemetry.recordTokenUsage({
				promptTokens: 0, // Whisper doesn't have prompt tokens
				completionTokens: estimatedTokens,
				totalTokens: estimatedTokens,
				model: "whisper-1",
				operation: "transcription",
				editMode: false,
			});

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
				useEditMode: z
					.boolean()
					.optional()
					.default(this.plugin.settings.USE_EDIT_MODE_BY_DEFAULT)
					.describe(
						"Whether to use the edit mode for faster completions. Only set to true if this involves editing an existing file with moderate to substantial changes.",
					),
			});

			const response = await this.createInstructorChatCompletion(actionSchema, [
				{
					role: "system",
					content: "You are an assistant that can execute actions",
				},
				{
					role: "user",
					content: userInput,
				},
			]);

			// Ensure response is an ActionResponse
			if (!isActionResponse(response)) {
				throw new Error("Invalid action response format");
			}

			const actionResult = response;
			const necessaryContexts = actionResult.necessaryContexts ?? [];

			this.trigger("actionPlanned", actionResult.action, necessaryContexts);

			const input = new Map<string, unknown>();

			// Filter contexts to those present in editorState
			const validContextKeys = necessaryContexts.filter(
				(key) => key in editorState,
			) as Array<keyof Partial<EditorState>>;

			// Add contexts to input
			for (const key of validContextKeys) {
				input.set(key, editorState[key]);
			}

			// Add additional inputs
			input.set("action", actionResult.action);
			input.set(
				"actionDescription",
				this.plugin.actionManager.getAction(actionResult.action)?.description,
			);
			input.set("userInput", userInput);

			// Add edit mode flag if specified
			if (actionResult.useEditMode !== undefined) {
				input.set("useEditMode", actionResult.useEditMode);
			}

			logger.debug("input", { input });

			// Execute the action
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

			// Record token usage if available
			// Need to use type assertion since the Instructor response type doesn't expose usage data
			if (hasUsage(response)) {
				telemetry.recordTokenUsage({
					promptTokens: response.usage.prompt_tokens,
					completionTokens: response.usage.completion_tokens,
					totalTokens: response.usage.total_tokens,
					model: this.plugin.settings.OPENAI_MODEL,
					operation: "instructor_completion",
					editMode: false,
				});
			}

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
		useEditMode: boolean = false,
		fileContent?: string,
	) {
		this.abortController = new AbortController();
		try {
			// Create base options
			const baseOptions = {
				messages,
				model: this.plugin.settings.OPENAI_MODEL,
				...options,
			};

			// Add prediction for edit mode if enabled and file content is available
			if (useEditMode && fileContent) {
				// Custom interface to type the options properly
				interface PredictionOptions extends Record<string, unknown> {
					messages: Array<ChatCompletionMessageParam>;
					model: string;
					prediction: {
						content: string;
						type: string;
					};
				}

				// Create options with prediction property
				const optionsWithPrediction: PredictionOptions = {
					...baseOptions,
					prediction: {
						content: fileContent,
						type: "content",
					},
				};

				const response = await this.oai.chat.completions.create(
					optionsWithPrediction as unknown as OpenAI.ChatCompletionCreateParams,
					{ signal: this.abortController.signal },
				);

				// Record token usage if available
				if (hasUsage(response)) {
					telemetry.recordTokenUsage({
						promptTokens: response.usage.prompt_tokens,
						completionTokens: response.usage.completion_tokens,
						totalTokens: response.usage.total_tokens,
						model: this.plugin.settings.OPENAI_MODEL,
						operation: "chat_completion",
						editMode: true,
					});
				}

				return response;
			}

			// Standard mode without prediction
			const response = await this.oai.chat.completions.create(
				baseOptions as OpenAI.ChatCompletionCreateParams,
				{ signal: this.abortController.signal },
			);

			// Record token usage
			if (hasUsage(response)) {
				telemetry.recordTokenUsage({
					promptTokens: response.usage.prompt_tokens,
					completionTokens: response.usage.completion_tokens,
					totalTokens: response.usage.total_tokens,
					model: this.plugin.settings.OPENAI_MODEL,
					operation: "chat_completion",
					editMode: false,
				});
			}

			return response;
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
			// Stream mode doesn't provide token usage information
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
