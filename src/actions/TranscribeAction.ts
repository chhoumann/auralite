import { removeWhitespace } from "@/utils";
import { createStreamingInserter } from "@/utils";
import type { Editor, EditorPosition, View } from "obsidian";
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

	private activeView?: View;
	private cursor?: EditorPosition;
	private activeEditor?: Editor;

	constructor() {
		super(
			"transcribe",
			TranscribeAction.inputSchema,
			TranscribeAction.systemPrompt,
			true,
		);
	}

	protected override async preExecute(context: ActionContext): Promise<void> {
		const {
			state: {
				editor: { activeView, cursor, activeEditor },
			},
		} = context;
		this.activeView = activeView;

		if (!this.activeView) {
			console.error("No active Markdown view");
			return;
		}

		this.cursor = cursor;
		this.activeEditor = activeEditor;
	}

	protected async performAction(
		input: z.infer<typeof TranscribeAction.inputSchema>,
		context: ActionContext,
	): Promise<void> {
		if (!this.activeView || !this.cursor || !this.activeEditor) {
			console.error("No active Markdown view or cursor position");
			return;
		}

		this.activeEditor.replaceRange(input.transcription, this.cursor);
	}

	protected override async performActionStream(
		stream: Stream<z.infer<typeof TranscribeAction.inputSchema>>,
		context: ActionContext,
	): Promise<void> {
		if (!this.activeView || !this.cursor || !this.activeEditor) {
			console.error("No active Markdown view or cursor position");
			return;
		}

		const insertStreamedContent = createStreamingInserter(
			this.activeEditor,
			this.cursor,
		);

		const { processor, fullContent } = await this.getStreamProcessor(
			stream,
			context,
			"transcription",
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
				console.log("Transcribe action was cancelled");
				throw new Error("Transcribe action cancelled");
			}
			console.error("Error performing transcribe action:", error);
			throw new Error("Failed to perform transcribe action");
		}
	}
}
