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
		
		// Start recording telemetry
		const requestId = telemetry.startRecording(
			"whisper-1", 
			"transcription"
		);

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
			
			// Finish recording telemetry
			telemetry.finishRecording(requestId, {
				promptTokens: 0, // Whisper doesn't have prompt tokens
				completionTokens: estimatedTokens,
				response: response
			});

			this.trigger("transcriptionComplete", response.text);

			return response.text;
		} catch (error: unknown) {
			// Record error in telemetry
			if (error instanceof Error) {
				telemetry.finishRecording(requestId, {
					promptTokens: 0,
					completionTokens: 0,
					error: error
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
		
		// Start recording telemetry
		const requestId = telemetry.startRecording(
			this.plugin.settings.OPENAI_MODEL,
			"instructor_completion",
			{
				requestPayload: { messages, schema: schema.description }
			}
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
					response: telemetry.isDebugMode() ? response : undefined
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
					response: telemetry.isDebugMode() ? response : undefined
				});
			}

			return response;
		} catch (error: unknown) {
			if (error instanceof Error) {
				// Record the error in telemetry
				telemetry.finishRecording(requestId, {
					promptTokens: telemetry.estimateTokenCount(JSON.stringify(messages)),
					completionTokens: 0,
					error: error
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
		
		// Start recording telemetry
		const requestId = telemetry.startRecording(
			this.plugin.settings.OPENAI_MODEL,
			"instructor_stream",
			{
				isStreaming: true,
				requestPayload: { messages, schema: schema.description }
			}
		);
		
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

			// For streaming responses, we can't get token usage from the API
			// Set up a collector to estimate tokens
			let streamContent = "";
			let lastChunkTime = Date.now();
			
			// Track stream chunks to estimate completion content length
			const originalAsyncIterator = stream[Symbol.asyncIterator].bind(stream);
			const wrappedStream = {
				...stream,
				[Symbol.asyncIterator]: async function*() {
					try {
						for await (const chunk of originalAsyncIterator()) {
							lastChunkTime = Date.now();
							
							// Extract content to estimate tokens
							if (chunk && typeof chunk === 'object') {
								// Try to extract content from common stream formats
								if ('content' in chunk && typeof chunk.content === 'string') {
									streamContent += chunk.content;
								} else if ('choices' in chunk && Array.isArray(chunk.choices) && 
									chunk.choices[0]?.delta?.content) {
									streamContent += chunk.choices[0].delta.content;
								}
							}
							
							yield chunk;
						}
						
						// When the stream is complete, record the telemetry
						const promptTokens = telemetry.estimateTokenCount(JSON.stringify(messages));
						const completionTokens = telemetry.estimateTokenCount(streamContent);
						
						telemetry.finishRecording(requestId, {
							promptTokens,
							completionTokens,
							totalTokens: promptTokens + completionTokens
						});
					} catch (e) {
						if (e instanceof Error) {
							telemetry.finishRecording(requestId, {
								promptTokens: telemetry.estimateTokenCount(JSON.stringify(messages)),
								completionTokens: telemetry.estimateTokenCount(streamContent),
								error: e
							});
						}
						throw e;
					}
				}
			};
			
			return wrappedStream as Stream<z.infer<TSchema>>;
		} catch (error: unknown) {
			if (error instanceof Error) {
				// Record the error in telemetry
				telemetry.finishRecording(requestId, {
					promptTokens: telemetry.estimateTokenCount(JSON.stringify(messages)),
					completionTokens: 0,
					error: error
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
		
		// Start recording telemetry
		const requestId = telemetry.startRecording(
			this.plugin.settings.OPENAI_MODEL,
			"chat_completion",
			{
				editMode: useEditMode,
				requestPayload: telemetry.isDebugMode() ? { messages, options } : undefined
			}
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
						response: telemetry.isDebugMode() ? response : undefined
					});
				} else {
					// If usage info isn't available, estimate from the messages and response
					const promptText = JSON.stringify(messages);
					const responseText = JSON.stringify(response);
					
					telemetry.finishRecording(requestId, {
						promptTokens: telemetry.estimateTokenCount(promptText),
						completionTokens: telemetry.estimateTokenCount(responseText),
						response: telemetry.isDebugMode() ? response : undefined
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
					response: telemetry.isDebugMode() ? response : undefined
				});
			} else {
				// If usage info isn't available, estimate from the messages and response
				const promptText = JSON.stringify(messages);
				const responseText = JSON.stringify(response);
				
				telemetry.finishRecording(requestId, {
					promptTokens: telemetry.estimateTokenCount(promptText),
					completionTokens: telemetry.estimateTokenCount(responseText),
					response: telemetry.isDebugMode() ? response : undefined
				});
			}

			return response;
		} catch (error) {
			if (error instanceof Error) {
				// Record the error in telemetry
				telemetry.finishRecording(requestId, {
					promptTokens: telemetry.estimateTokenCount(JSON.stringify(messages)),
					completionTokens: 0,
					error: error
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
		
		// Start recording telemetry
		const requestId = telemetry.startRecording(
			this.plugin.settings.OPENAI_MODEL,
			"chat_completion_stream",
			{
				isStreaming: true,
				requestPayload: telemetry.isDebugMode() ? { messages, options } : undefined
			}
		);
		
		try {
			const stream = await this.oai.chat.completions.create(
				{
					messages,
					model: this.plugin.settings.OPENAI_MODEL,
					stream: true,
					...options,
				},
				{ signal: this.abortController.signal },
			);

			// For streaming responses, we can't get token usage from the API
			// Set up a collector to estimate tokens
			let streamContent = "";
			
			// Track stream chunks to estimate completion content length
			const originalAsyncIterator = stream[Symbol.asyncIterator].bind(stream);
			const wrappedStream = {
				...stream,
				[Symbol.asyncIterator]: async function*() {
					try {
						for await (const chunk of originalAsyncIterator()) {
							// Extract content to estimate tokens
							if (chunk && typeof chunk === 'object' && 'choices' in chunk 
								&& Array.isArray(chunk.choices)) {
								const content = chunk.choices[0]?.delta?.content;
								if (content) {
									streamContent += content;
								}
							}
							
							yield chunk;
						}
						
						// When the stream is complete, record the telemetry
						const promptTokens = telemetry.estimateTokenCount(JSON.stringify(messages));
						const completionTokens = telemetry.estimateTokenCount(streamContent);
						
						telemetry.finishRecording(requestId, {
							promptTokens,
							completionTokens,
							totalTokens: promptTokens + completionTokens
						});
					} catch (e) {
						if (e instanceof Error) {
							telemetry.finishRecording(requestId, {
								promptTokens: telemetry.estimateTokenCount(JSON.stringify(messages)),
								completionTokens: telemetry.estimateTokenCount(streamContent),
								error: e
							});
						}
						throw e;
					}
				}
			};
			
			return wrappedStream;
		} catch (error) {
			if (error instanceof Error) {
				// Record the error in telemetry
				telemetry.finishRecording(requestId, {
					promptTokens: telemetry.estimateTokenCount(JSON.stringify(messages)),
					completionTokens: 0,
					error: error
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
