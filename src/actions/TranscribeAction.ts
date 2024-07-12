import { logger } from "@/logging";
import { getOpenAIChatStreamProcessor, removeWhitespace } from "@/utils";
import { createStreamingInserter } from "@/utils";
import { type Editor, type EditorPosition, MarkdownView } from "obsidian";
import type { ChatCompletion, ChatCompletionChunk } from "openai/resources";
import type { Stream } from "openai/streaming";
import { z } from "zod";
import { Action, type ActionContext } from "./Action";

export class TranscribeAction extends Action<
	typeof TranscribeAction.inputSchema
> {
	readonly description = "Format transcribed audio to be more readable.";

	static inputSchema = z.object({
		transcription: z
			.string()
			.describe("The formatted transcription of the audio."),
	});

	static systemPrompt = removeWhitespace(`You format transcribed audio to be more readable.

            As an AI assistant within Obsidian, your primary goal is to help users manage their ideas and knowledge more effectively.
            Format your responses using Markdown syntax.
            Please use the [[Obsidian]] link format.
            You can write aliases for the links by writing [[Obsidian|the alias after the pipe symbol]].

			The user has already provided you with the transcription of the audio, in "userInput".
			You need to format the transcription in a way that is easy for the user to understand.
			Remove the part where the user asked you to transcribe the audio and focus actual content.
        `);

	private cursor?: EditorPosition;
	private activeEditor?: Editor;
	private activeView?: MarkdownView;

	constructor() {
		super(
			"transcribe",
			TranscribeAction.inputSchema,
			TranscribeAction.systemPrompt,
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
			{ bufferSize: 50 },
		);

		const { processor, fullContent } = await getOpenAIChatStreamProcessor({
			stream,
			abortSignal: context.abortSignal,
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
			logger.debug("Transcribe action results", { results: context.results });
		} catch (error: unknown) {
			if (error instanceof Error && error.name === "AbortError") {
				logger.error("Transcribe action was cancelled", { error });
				throw new Error("Transcribe action cancelled");
			}
			logger.error("Error performing transcribe action", { error });
			throw new Error("Failed to perform transcribe action");
		}
	}
}
