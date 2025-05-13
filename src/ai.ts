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
import { withTelemetry, type TelemetryContext } from "@/utils/withTelemetry";
import { getOrCreateSessionId, generateRequestId } from "@/utils/session";

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

		// Use the selected transcription model from settings
		const model = this.plugin.settings.TRANSCRIPTION_MODEL;
		const requestId = telemetry.startRecording(model, "transcription");

		try {
			const response = await this.oai.audio.transcriptions.create(
				{
					file: new File([audioData.buffer], `audio.${audioData.mimeType}`),
					model,
				},
				{ signal: this.abortController.signal },
			);

			// Record transcription usage (estimate based on text length since Whisper API doesn't provide token counts)
			const estimatedTokens = Math.ceil(response.text.length / 4); // ~4 chars per token as a rough estimate

			// Finish recording telemetry
			telemetry.finishRecording(requestId, {
				promptTokens: 0, // Whisper/gpt-4o-transcribe doesn't have prompt tokens
				completionTokens: estimatedTokens,
				response: response,
			});

			this.trigger("transcriptionComplete", response.text);

			return response.text;
		} catch (error: unknown) {
			// Record error in telemetry
			if (error instanceof Error) {
				telemetry.finishRecording(requestId, {
					promptTokens: 0,
					completionTokens: 0,
					error: error,
				});

				if (error.name === "AbortError") {
					logger.error("Audio transcription was cancelled", { error });
					throw new Error("Audio transcription cancelled");
				}
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

		const context: TelemetryContext = {
			sessionId: getOrCreateSessionId(),
			actionId: "run_operation",
			requestId: generateRequestId(),
			fileName: editorState?.currentFile?.name,
			pluginVersion: this.plugin.manifest?.version,
		};

		await withTelemetry(
			"run_operation",
			this.plugin.settings.OPENAI_MODEL,
			context,
			async (requestId, ctx) => {
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

				const response = await this.createInstructorChatCompletion(
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

				// Record successful completion of the entire run operation
				// We'll collect telemetry from the context results
				telemetry.finishRecording(requestId, {
					promptTokens: telemetry.estimateTokenCount(userInput),
					completionTokens: telemetry.estimateTokenCount(
						JSON.stringify(Object.fromEntries(input)),
					),
					response: telemetry.isDebugMode()
						? {
								action: actionResult.action,
								contexts: necessaryContexts,
							}
						: undefined,
				});

				this.trigger("processingComplete");
			},
			() => ({
				requestPayload: telemetry.isDebugMode() ? { userInput } : undefined,
			}),
		);
	}

	async createInstructorChatCompletion<TSchema extends z.AnyZodObject>(
		schema: TSchema,
		messages: Array<ChatCompletionMessageParam>,
	) {
		this.abortController = new AbortController();

		const context: TelemetryContext = {
			sessionId: getOrCreateSessionId(),
			actionId: "instructor_completion",
			requestId: generateRequestId(),
			pluginVersion: this.plugin.manifest?.version,
		};
		const options = {
			requestPayload: { messages, schema: schema.description },
		};
		const requestId = telemetry.startRecording(
			this.plugin.settings.OPENAI_MODEL,
			"instructor_completion",
			context,
			options,
		);

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
			if (hasUsage(response)) {
				telemetry.finishRecording(requestId, {
					promptTokens: response.usage.prompt_tokens,
					completionTokens: response.usage.completion_tokens,
					totalTokens: response.usage.total_tokens,
					response: telemetry.isDebugMode() ? response : undefined,
				});
			} else {
				// If usage info isn't available, estimate from the messages and response
				const promptText = JSON.stringify(messages);
				const responseText = JSON.stringify(response);
				const promptTokens = telemetry.estimateTokenCount(promptText);
				const completionTokens = telemetry.estimateTokenCount(responseText);

				telemetry.finishRecording(requestId, {
					promptTokens,
					completionTokens,
					response: telemetry.isDebugMode() ? response : undefined,
				});
			}

			return response;
		} catch (error: unknown) {
			if (error instanceof Error) {
				// Record the error in telemetry
				telemetry.finishRecording(requestId, {
					promptTokens: telemetry.estimateTokenCount(JSON.stringify(messages)),
					completionTokens: 0,
					error: error,
				});

				if (error.name === "AbortError") {
					logger.error("Chat completion was cancelled", { error });
					throw new Error("Chat completion cancelled");
				}
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

		const context: TelemetryContext = {
			sessionId: getOrCreateSessionId(),
			actionId: "instructor_stream",
			requestId: generateRequestId(),
			pluginVersion: this.plugin.manifest?.version,
		};
		const options = {
			isStreaming: true,
			requestPayload: { messages, schema: schema.description },
		};
		const requestId = telemetry.startRecording(
			this.plugin.settings.OPENAI_MODEL,
			"instructor_stream",
			context,
			options,
		);

		try {
			// Create the original stream
			const originalStream =
				await this.instructorClient.chat.completions.create(
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

			// Schedule telemetry recording for after stream completes
			setTimeout(() => {
				// Very crude estimate of token usage for streams
				const promptTokens = telemetry.estimateTokenCount(
					JSON.stringify(messages),
				);
				// For completions, we'll estimate based on the model (less accurate)
				const completionTokens = Math.ceil(promptTokens * 1.5); // Rough estimate that completions are ~1.5x input size

				telemetry.finishRecording(requestId, {
					promptTokens,
					completionTokens,
					totalTokens: promptTokens + completionTokens,
				});
			}, 30000); // Wait 30 seconds to allow stream to complete

			// Return the original stream without modification
			return originalStream as unknown as Stream<z.infer<TSchema>>;
		} catch (error: unknown) {
			if (error instanceof Error) {
				// Record the error in telemetry
				telemetry.finishRecording(requestId, {
					promptTokens: telemetry.estimateTokenCount(JSON.stringify(messages)),
					completionTokens: 0,
					error: error,
				});

				if (error.name === "AbortError") {
					logger.error("Chat completion stream was cancelled", { error });
					throw new Error("Chat completion stream cancelled");
				}
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

		const context: TelemetryContext = {
			sessionId: getOrCreateSessionId(),
			actionId: "chat_completion",
			requestId: generateRequestId(),
			pluginVersion: this.plugin.manifest?.version,
		};
		const telemetryOptions = {
			editMode: useEditMode,
			requestPayload: telemetry.isDebugMode()
				? { messages, options }
				: undefined,
		};
		const requestId = telemetry.startRecording(
			this.plugin.settings.OPENAI_MODEL,
			"chat_completion",
			context,
			telemetryOptions,
		);

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
					telemetry.finishRecording(requestId, {
						promptTokens: response.usage.prompt_tokens,
						completionTokens: response.usage.completion_tokens,
						totalTokens: response.usage.total_tokens,
						response: telemetry.isDebugMode() ? response : undefined,
					});
				} else {
					// If usage info isn't available, estimate from the messages and response
					const promptText = JSON.stringify(messages);
					const responseText = JSON.stringify(response);

					telemetry.finishRecording(requestId, {
						promptTokens: telemetry.estimateTokenCount(promptText),
						completionTokens: telemetry.estimateTokenCount(responseText),
						response: telemetry.isDebugMode() ? response : undefined,
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
				telemetry.finishRecording(requestId, {
					promptTokens: response.usage.prompt_tokens,
					completionTokens: response.usage.completion_tokens,
					totalTokens: response.usage.total_tokens,
					response: telemetry.isDebugMode() ? response : undefined,
				});
			} else {
				// If usage info isn't available, estimate from the messages and response
				const promptText = JSON.stringify(messages);
				const responseText = JSON.stringify(response);

				telemetry.finishRecording(requestId, {
					promptTokens: telemetry.estimateTokenCount(promptText),
					completionTokens: telemetry.estimateTokenCount(responseText),
					response: telemetry.isDebugMode() ? response : undefined,
				});
			}

			return response;
		} catch (error) {
			if (error instanceof Error) {
				// Record the error in telemetry
				telemetry.finishRecording(requestId, {
					promptTokens: telemetry.estimateTokenCount(JSON.stringify(messages)),
					completionTokens: 0,
					error: error,
				});

				if (error.name === "AbortError") {
					logger.error("Chat completion was cancelled", { error });
					throw new Error("Chat completion cancelled");
				}
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

		const context: TelemetryContext = {
			sessionId: getOrCreateSessionId(),
			actionId: "chat_completion_stream",
			requestId: generateRequestId(),
			pluginVersion: this.plugin.manifest?.version,
		};
		const telemetryOptions = {
			isStreaming: true,
			requestPayload: telemetry.isDebugMode()
				? { messages, options }
				: undefined,
		};
		const requestId = telemetry.startRecording(
			this.plugin.settings.OPENAI_MODEL,
			"chat_completion_stream",
			context,
			telemetryOptions,
		);

		try {
			// Create the original stream
			const stream = await this.oai.chat.completions.create(
				{
					messages,
					model: this.plugin.settings.OPENAI_MODEL,
					stream: true,
					...options,
				},
				{ signal: this.abortController.signal },
			);

			// Schedule telemetry recording for after stream completes
			setTimeout(() => {
				// Very crude estimate of token usage for streams
				const promptTokens = telemetry.estimateTokenCount(
					JSON.stringify(messages),
				);
				// For completions, we'll estimate based on the model (less accurate)
				const completionTokens = Math.ceil(promptTokens * 1.5); // Rough estimate that completions are ~1.5x input size

				telemetry.finishRecording(requestId, {
					promptTokens,
					completionTokens,
					totalTokens: promptTokens + completionTokens,
				});
			}, 30000); // Wait 30 seconds to allow stream to complete

			// Return the original stream without modification
			return stream;
		} catch (error) {
			if (error instanceof Error) {
				// Record the error in telemetry
				telemetry.finishRecording(requestId, {
					promptTokens: telemetry.estimateTokenCount(JSON.stringify(messages)),
					completionTokens: 0,
					error: error,
				});

				if (error.name === "AbortError") {
					logger.error("Chat completion stream was cancelled", { error });
					throw new Error("Chat completion stream cancelled");
				}
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
