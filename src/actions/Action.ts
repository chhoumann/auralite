import type { App, Editor, EditorPosition, View } from "obsidian";
import type OpenAI from "openai";
import type {
	ChatCompletion,
	ChatCompletionChunk,
	ChatCompletionMessageParam,
} from "openai/resources";
import type { Stream } from "openai/streaming";
import type * as z from "zod/mini";
import type { AIManager } from "@/ai";
import { logger } from "@/logging";
import type AuralitePlugin from "@/main";
import { renderTemplate } from "@/TemplateEngine";

export type EditorState = {
	activeView: View;
	activeEditor: Editor;
	cursor: EditorPosition;
	currentSelection: string;
	currentLine: string;
	currentFile: {
		name: string;
		path: string;
		content: string;
	};
};

export interface ActionContext {
	plugin: AuralitePlugin;
	app: App;
	oai: OpenAI;
	ai: AIManager;
	results: Map<string, unknown>;
	abortSignal: AbortSignal;
	state: {
		editor: Partial<EditorState>;
	};
	/**
	 * The model to use for this action, if overridden.
	 */
	model?: string;
}

export abstract class Action<TInput extends z.ZodMiniObject> {
	abstract readonly description: string;

	/**
	 * Whether this action uses an LLM.
	 * Used to determine if per-action model selection should be shown in settings.
	 */
	readonly usesLLM: boolean = true;

	constructor(
		readonly id: string,
		readonly inputSchema: TInput,
		readonly systemPrompt: string,
		readonly supportsStreaming: boolean = false,
		readonly structuredOutput: boolean = true,
	) {}

	async execute(context: ActionContext): Promise<void> {
		await this.preExecute(context);

		if (context.abortSignal.aborted) {
			throw new Error("Action cancelled");
		}

		const prompt = renderTemplate(this.systemPrompt, context.results);

		const msgs: Array<ChatCompletionMessageParam> = [
			{ role: "system", content: prompt },
			{
				role: "system",
				content: `## Context:\n${JSON.stringify(Object.fromEntries(context.results))}`,
			},
		];

		logger.debug("messages:", { msgs });

		if (this.structuredOutput) {
			const input = await context.ai.createStructuredChatCompletion(
				this.inputSchema,
				msgs,
			);
			await this.performAction(input, context);
		} else if (this.supportsStreaming) {
			const stream = await context.ai.createOpenAIChatCompletionStream(msgs);
			await this.performActionStream(stream, context);
		} else {
			const response = await context.ai.createOpenAIChatCompletion(msgs);
			await this.performAction(response, context);
		}
	}

	protected async preExecute(_context: ActionContext): Promise<void> {}

	protected abstract performAction(
		input: z.infer<TInput> | ChatCompletion,
		context: ActionContext,
	): Promise<void>;

	protected async performActionStream(
		_stream: Stream<ChatCompletionChunk>,
		_context: ActionContext,
	): Promise<void> {
		throw new Error("Streaming not implemented for this action");
	}
}
