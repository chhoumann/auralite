import { removeWhitespace } from "@/utils";
import { createStreamingInserter } from "@/utils";
import { type Editor, type EditorPosition, MarkdownView } from "obsidian";
import type { Stream } from "openai/streaming";
import { z } from "zod";
import { Action, type ActionContext } from "./Action";

export class WriteAction extends Action<typeof WriteAction.inputSchema> {
	readonly description = "Write content to the current file.";

	static inputSchema = z.object({
		content: z.string().describe("The content to write to the file."),
	});

	static systemPrompt = removeWhitespace(`You are an AI assistant writing content directly into an Obsidian note.
        Format your responses using Markdown syntax.
        Use the [[Obsidian]] link format for internal links.
        You can write aliases for links using [[Obsidian|alias]] format.
        Use LaTeX syntax for mathematical notation, surrounded by $$ for block equations or $ for inline expressions.
    `);

	private cursor?: EditorPosition;
	private activeEditor?: Editor;

	constructor() {
		super("write", WriteAction.inputSchema, WriteAction.systemPrompt, true);
	}

	protected override async preExecute(context: ActionContext): Promise<void> {
		const activeView =
			context.app.workspace.getActiveViewOfType(MarkdownView) ?? undefined;
		const cursor = activeView?.editor.getCursor();

		this.cursor = cursor;
		this.activeEditor = activeView?.editor;
	}

	protected async performAction(
		input: z.infer<typeof WriteAction.inputSchema>,
		context: ActionContext,
	): Promise<void> {
		if (!this.activeEditor || !this.cursor) {
			throw new Error("No active editor or cursor position");
		}
		this.activeEditor.replaceRange(input.content, this.cursor);
	}

	protected override async performActionStream(
		stream: Stream<z.infer<typeof WriteAction.inputSchema>>,
		context: ActionContext,
	): Promise<void> {
		if (!this.activeEditor || !this.cursor) {
			throw new Error("No active editor or cursor position");
		}

		const insertStreamedContent = createStreamingInserter(
			this.activeEditor,
			this.cursor,
		);

		const { processor, fullContent } = await this.getStreamProcessor(
			stream,
			context,
			"content",
		);

		try {
			for await (const chunk of processor) {
				if (context.abortSignal.aborted) {
					throw new Error("Action cancelled");
				}

				insertStreamedContent(chunk);
			}

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
