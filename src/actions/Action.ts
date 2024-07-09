import type { AIManager } from "@/ai";
import type OVSPlugin from "@/main";
import { openFile } from "@/obsidianUtils";
import type Instructor from "@instructor-ai/instructor";
import {
	type App,
	type Editor,
	type EditorPosition,
	MarkdownView,
	type View,
} from "obsidian";
import type OpenAI from "openai";
import type { Stream } from "openai/streaming";
import { z } from "zod";
import { removeWhitespace } from "./removeWhitespace";

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

	protected performActionStream(
		stream: Stream<z.infer<TInput>>,
		context: ActionContext,
	): Promise<void> {
		throw new Error("Streaming not implemented for this action");
	}
}

export class CompositeAction extends Action<z.AnyZodObject> {
	readonly description = "Execute multiple actions in sequence or in parallel.";

	private actions: Action<z.AnyZodObject>[];

	constructor(
		id: string,
		actions: Action<z.AnyZodObject>[],
		private parallel = false,
	) {
		super(id, z.object({}), "");
		this.actions = actions;
	}

	override async execute(context: ActionContext): Promise<void> {
		if (this.parallel) {
			await Promise.all(
				this.actions.map((action) => {
					if (context.abortSignal.aborted) {
						throw new Error("Action cancelled");
					}
					return action.execute(context);
				}),
			);
		} else {
			for (const action of this.actions) {
				if (context.abortSignal.aborted) {
					throw new Error("Action cancelled");
				}
				await action.execute(context);
			}
		}
	}

	protected async performAction(
		_input: z.infer<z.AnyZodObject>,
		_context: ActionContext,
	): Promise<void> {}
}

export class CreateNoteAction extends Action<
	typeof CreateNoteAction.inputSchema
> {
	readonly description = "Create a new note.";

	static inputSchema = z.object({
		noteName: z
			.string()
			.describe(
				"The name of the note to create. Must be a valid markdown filename.",
			),
		content: z.string().optional().describe("The content of the note."),
		paneType: z
			.enum(["tab", "split", "window"])
			.optional()
			.default("tab")
			.describe("The type of pane to open the file in."),
		direction: z
			.enum(["horizontal", "vertical"])
			.optional()
			.describe("The direction to split the pane, if paneType is 'split'."),
		mode: z
			.enum(["source", "preview", "default"])
			.optional()
			.default("default")
			.describe("The view mode to open the file in."),
		focus: z
			.boolean()
			.optional()
			.default(true)
			.describe("Whether to focus the file after opening."),
	});

	static systemPrompt = removeWhitespace(`You are an expert at creating notes in Obsidian.
            As an AI assistant within Obsidian, your primary goal is to help users manage their ideas and knowledge more effectively.
            Format your responses using Markdown syntax.
            Please use the [[Obsidian]] link format.
            You can write aliases for the links by writing [[Obsidian|the alias after the pipe symbol]].
            To use mathematical notation, use LaTeX syntax.
            LaTeX syntax for larger equations should be on separate lines, surrounded with double dollar signs ($$).
            You can also inline math expressions by wrapping it in $ symbols.
            For example, use $$w_{ij}^{	ext{new}}:=w_{ij}^{	ext{current}}+etacdotdelta_jcdot x_{ij}$$ on a separate line, but you can write "($eta$ = learning rate, $delta_j$ = error term, $x_{ij}$ = input)" inline.
        `);

	constructor() {
		super(
			"create-note",
			CreateNoteAction.inputSchema,
			CreateNoteAction.systemPrompt,
		);
	}

	protected async performAction(
		input: z.infer<typeof CreateNoteAction.inputSchema>,
		context: ActionContext,
	): Promise<void> {
		if (context.abortSignal.aborted) {
			throw new Error("Action cancelled");
		}

		console.log("Creating note:", input);

		const noteName = input.noteName.endsWith(".md")
			? input.noteName
			: `${input.noteName}.md`;

		const note = await context.app.vault.create(
			`dev/${noteName}`,
			input.content || "",
		);

		openFile(context.app, note, {
			paneType: input.paneType,
			direction: input.direction,
			mode: input.mode,
			focus: input.focus,
		});

		context.results.set(this.id, {
			noteName: input.noteName,
			content: input.content,
		});
	}
}

export class NoopAction extends Action<typeof NoopAction.inputSchema> {
	readonly description =
		"This action does nothing and is used when no specific action is required.";

	static inputSchema = z.object({});

	constructor() {
		super(
			"none",
			NoopAction.inputSchema,
			"This action does nothing and is used when no specific action is required.",
		);
	}

	protected async performAction(
		_input: z.infer<typeof NoopAction.inputSchema>,
		_context: ActionContext,
	): Promise<void> {
		// This action intentionally does nothing
		console.log("Noop action executed");
	}
}

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

		let fullTranscription = "";
		let lastInsertedLength = 0;

		for await (const chunk of stream) {
			if (context.abortSignal.aborted) {
				throw new Error("Action cancelled");
			}

			if (chunk.transcription) {
				// Append the new chunk to the full transcription
				fullTranscription = chunk.transcription;

				// Calculate the new content to insert
				const newContent = fullTranscription.slice(lastInsertedLength);

				if (newContent) {
					// Insert only the new content
					this.activeEditor.replaceRange(newContent, this.cursor);
					this.cursor.ch += newContent.length;
					lastInsertedLength += newContent.length;
				}
			}
		}

		context.results.set(this.id, { transcription: fullTranscription });
	}
}

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
		super(
			"write",
			WriteAction.inputSchema,
			WriteAction.systemPrompt,
			true, // Enable streaming
		);
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

		let fullContent = "";
		const lastCursor = this.cursor;
		let lastInsertedLength = 0;

		try {
			for await (const chunk of stream) {
				if (context.abortSignal.aborted) {
					throw new Error("Action cancelled");
				}

				if (!chunk.content) {
					continue;
				}

				fullContent = chunk.content;
				const newContent = fullContent.slice(lastInsertedLength);

				if (!newContent) {
					continue;
				}

				lastInsertedLength += newContent.length;

				const lines = newContent.split("\n");
				if (lines.length > 1) {
					for (const line of lines) {
						this.activeEditor.replaceRange(`${line}\n`, lastCursor);
						lastCursor.line++;
						lastCursor.ch = 0;
					}
				} else {
					this.activeEditor.replaceRange(newContent, lastCursor);
					lastCursor.ch += newContent.length;
				}
			}

			context.results.set(this.id, { content: fullContent });
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
