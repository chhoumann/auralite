import { removeWhitespace } from "@/utils";
import { createStreamingInserter } from "@/utils";
import { getOpenAIStreamProcessor } from "@/utils";
import { type Editor, type EditorPosition, MarkdownView } from "obsidian";
import type { ChatCompletion, ChatCompletionChunk } from "openai/resources";
import type { Stream } from "openai/streaming";
import { z } from "zod";
import { Action, type ActionContext } from "./Action";

export class WriteAction extends Action<typeof WriteAction.inputSchema> {
	readonly description = "Write content where the user has their cursor.";

	static inputSchema = z.object({
		never: z.never(),
	});

	static systemPrompt = removeWhitespace(`You are an AI assistant writing content directly into an Obsidian note.
        Format your responses using Markdown syntax.
        Use the [[Obsidian]] link format for internal links.
        You can write aliases for links using [[Obsidian|alias]] format.
        Use LaTeX syntax for mathematical notation, surrounded by $$ for block equations or $ for inline expressions.
    `);

	private cursor?: EditorPosition;
	private activeEditor?: Editor;
	private activeView?: MarkdownView;

	constructor() {
		super(
			"write",
			WriteAction.inputSchema,
			WriteAction.systemPrompt,
			true,
			false,
		);
	}

	protected override async preExecute(context: ActionContext): Promise<void> {
		const activeView =
			context.app.workspace.getActiveViewOfType(MarkdownView) ?? undefined;
		const cursor = activeView?.editor.getCursor();

		this.cursor = cursor;
		this.activeEditor = activeView?.editor;
		this.activeView = activeView;
	}

	protected async performAction(
		input: ChatCompletion,
		context: ActionContext,
	): Promise<void> {
		if (!this.activeEditor || !this.cursor || !this.activeView) {
			throw new Error("No active editor, view, or cursor position");
		}
		this.activeEditor.replaceRange(
			input.choices[0].message.content ?? "",
			this.cursor,
		);
	}

	protected override async performActionStream(
		stream: Stream<ChatCompletionChunk>,
		context: ActionContext,
	): Promise<void> {
		if (!this.activeEditor || !this.cursor || !this.activeView) {
			throw new Error("No active editor, view, or cursor position");
		}

		const { insertStreamedContent, flush } = createStreamingInserter(
			this.activeEditor,
			this.cursor,
			{
				// Maybe add this as a setting?
				// setCursor: (cursor) => {
				// 	this.activeEditor?.setCursor(cursor);
				// 	this.activeEditor?.scrollIntoView({
				// 		from: { line: cursor.line, ch: cursor.ch },
				// 		to: { line: cursor.line, ch: cursor.ch },
				// 	}, true);
				// },
				bufferSize: 50,
			},
		);

		const { processor, fullContent } = await getOpenAIStreamProcessor({
			stream,
			context,
		});

		try {
			for await (const chunk of processor) {
				if (context.abortSignal.aborted) {
					throw new Error("Action cancelled");
				}

				insertStreamedContent(chunk);
			}

			flush();

			context.results.set(this.id, { content: fullContent.value });
			console.log(context.results);
		} catch (error: unknown) {
			if (error instanceof Error && error.name === "AbortError") {
				console.log("Write action was cancelled");
				throw new Error("Write action cancelled");
			}
			console.error("Error performing write action:", error);
			throw new Error("Failed to perform write action");
		}
	}
}
