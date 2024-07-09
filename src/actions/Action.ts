import type { AIManager } from "@/ai";
import type OVSPlugin from "@/main";
import type Instructor from "@instructor-ai/instructor";
import type { App, Editor, EditorPosition, View } from "obsidian";
import type OpenAI from "openai";
import type { Stream } from "openai/streaming";
import type { z } from "zod";

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
	) {}

	async execute(context: ActionContext): Promise<void> {
		await this.preExecute(context);

		if (context.abortSignal.aborted) {
			throw new Error("Action cancelled");
		}

		const msgs = [
			{ role: "system", content: this.systemPrompt },
			{
				role: "system",
				content: `## Context:\n${JSON.stringify(Object.fromEntries(context.results))}`,
			},
		];

		console.log("messages:", msgs);

		if (this.supportsStreaming) {
			const stream = await context.ai.createChatCompletionStream(
				this.inputSchema,
				msgs,
			);
			await this.performActionStream(stream, context);
		} else {
			const input = await context.ai.createChatCompletion(
				this.inputSchema,
				msgs,
			);
			await this.performAction(input, context);
		}
	}

	protected async preExecute(context: ActionContext): Promise<void> {}

	protected abstract performAction(
		input: z.infer<TInput>,
		context: ActionContext,
	): Promise<void>;

	protected async getStreamProcessor(
		stream: Stream<z.infer<TInput>>,
		context: ActionContext,
		chunkKey: keyof z.infer<TInput>,
	): Promise<{
		processor: AsyncGenerator<string, void, unknown>;
		fullContent: { value: string };
	}> {
		const fullContent = { value: "" };

		return {
			processor: (async function* streamProcessor(
				stream: Stream<z.infer<TInput>>,
				context: ActionContext,
				chunkKey: keyof z.infer<TInput>,
			) {
				for await (const chunk of stream) {
					if (context.abortSignal.aborted) {
						throw new Error("Action cancelled");
					}
					if (chunk[chunkKey]) {
						const newContent = chunk[chunkKey].slice(fullContent.value.length);
						fullContent.value = chunk[chunkKey];
						yield newContent;
					}
				}
			})(stream, context, chunkKey),
			fullContent,
		};
	}

	protected async performActionStream(
		stream: Stream<z.infer<TInput>>,
		context: ActionContext,
	): Promise<void> {
		throw new Error("Streaming not implemented for this action");
	}
}
