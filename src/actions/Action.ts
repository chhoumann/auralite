import type { AIManager } from "@/ai";
import type OVSPlugin from "@/main";
import { openFile } from "@/obsidianUtils";
import type Instructor from "@instructor-ai/instructor";
import { type App, type EditorPosition, MarkdownView } from "obsidian";
import type OpenAI from "openai";
import { z } from "zod";
import { removeWhitespace } from "./removeWhitespace";

export interface ActionContext {
	plugin: OVSPlugin;
	app: App;
	oai: OpenAI;
	ai: AIManager;
	client: ReturnType<typeof Instructor>;
	results: Map<string, unknown>;
	abortSignal: AbortSignal;
}

export abstract class Action<TInput extends z.AnyZodObject> {
	constructor(
		readonly id: string,
		readonly inputSchema: TInput,
		readonly systemPrompt: string,
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

		console.log(msgs);
		const input = await context.ai.createChatCompletion(this.inputSchema, msgs);

		if (context.abortSignal.aborted) {
			throw new Error("Action cancelled");
		}

		await this.performAction(input, context);
	}

	protected async preExecute(context: ActionContext): Promise<void> {}

	protected abstract performAction(
		input: z.infer<TInput>,
		context: ActionContext,
	): Promise<void>;
}

export class CompositeAction extends Action<z.AnyZodObject> {
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
	static inputSchema = z.object({
		noteName: z
			.string()
			.endsWith(".md")
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

		const note = await context.app.vault.create(
			`dev/${input.noteName}`,
			input.content || "",
		);

		if (context.abortSignal.aborted) {
			// Optionally, you might want to delete the created note if cancelled
			await context.app.vault.delete(note);
			throw new Error("Action cancelled");
		}

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

	private activeView: MarkdownView | null = null;
	private cursor: EditorPosition | null = null;

	constructor() {
		super(
			"transcribe",
			TranscribeAction.inputSchema,
			TranscribeAction.systemPrompt,
		);
	}

	protected override async preExecute(context: ActionContext): Promise<void> {
		const { app } = context;
		this.activeView = app.workspace.getActiveViewOfType(MarkdownView);

		if (!this.activeView) {
			console.error("No active Markdown view");
			return;
		}

		this.cursor = this.activeView.editor.getCursor();
	}

	protected async performAction(
		input: z.infer<typeof TranscribeAction.inputSchema>,
		context: ActionContext,
	): Promise<void> {
		if (!this.activeView || !this.cursor) {
			console.error("No active Markdown view or cursor position");
			return;
		}

		const editor = this.activeView.editor;

		editor.replaceRange(input.transcription, this.cursor);
	}
}
