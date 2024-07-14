import type { AIManager } from "@/ai";
import { logger } from "@/logging";
import type OVSPlugin from "@/main";
import type Instructor from "@instructor-ai/instructor";
import type { App, Editor, EditorPosition, View } from "obsidian";
import type OpenAI from "openai";
import type {
	ChatCompletion,
	ChatCompletionChunk,
	ChatCompletionMessageParam,
} from "openai/resources";
import type { Stream } from "openai/streaming";
import type { z } from "zod";
import { renderTemplate } from "@/TemplateEngine";

export type EditorState = {
	activeView: View;
	activeEditor: Editor;
	cursor: EditorPosition;
	currentSelection: string;
	currentLine: string;
	currentFile: {
		name: string;
		content: string;
	};
};

export interface ActionContext {
	plugin: OVSPlugin;
	app: App;
	oai: OpenAI;
	ai: AIManager;
	client: ReturnType<typeof Instructor>;
	results: Map<string, unknown>;
	abortSignal: AbortSignal;
	state: {
		editor: Partial<EditorState>;
	};
}

export abstract class Action<TInput extends z.AnyZodObject> {
	abstract readonly description: string;

	constructor(
		readonly id: string,
		readonly inputSchema: TInput,
		readonly systemPrompt: string,
		readonly supportsStreaming: boolean = false,
		readonly useInstructor: boolean = true,
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

		if (this.useInstructor) {
			if (this.supportsStreaming) {
				const stream = await context.ai.createInstructorChatCompletionStream(
					this.inputSchema,
					msgs,
				);
				await this.performActionStream(stream, context);
			} else {
				const input = await context.ai.createInstructorChatCompletion(
					this.inputSchema,
					msgs,
				);
				await this.performAction(input, context);
			}
		} else {
			if (this.supportsStreaming) {
				const stream = await context.ai.createOpenAIChatCompletionStream(msgs);
				await this.performActionStream(stream, context);
			} else {
				const response = await context.ai.createOpenAIChatCompletion(msgs);
				await this.performAction(response, context);
			}
		}
	}

	protected async preExecute(context: ActionContext): Promise<void> {}

	protected abstract performAction(
		input: z.infer<TInput> | ChatCompletion,
		context: ActionContext,
	): Promise<void>;

	protected async performActionStream(
		stream: Stream<z.infer<TInput> | ChatCompletionChunk>,
		context: ActionContext,
	): Promise<void> {
		throw new Error("Streaming not implemented for this action");
	}
}