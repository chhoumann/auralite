import { logger } from "@/logging";
import { openFile } from "@/obsidianUtils";
import { removeWhitespace } from "@/utils";
import { z } from "zod";
import { Action, type ActionContext } from "./Action";
import { TFile } from "obsidian";
import { renderTemplate } from "@/TemplateEngine";

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

	private templateFileContent?: string;

	protected override async preExecute(context: ActionContext): Promise<void> {
		const templatePath = context.plugin.settings.DEFAULT_NOTE_TEMPLATE_PATH;

		if (templatePath) {
			const templateFile =
				context.app.vault.getAbstractFileByPath(templatePath);
			if (templateFile instanceof TFile) {
				this.templateFileContent =
					await context.app.vault.cachedRead(templateFile);
			}
		}

		const prompt = this.templateFileContent
			? removeWhitespace(
					`
				You are tasked with creating content for a note based on a given template. The template uses specific syntax that you need to be aware of:

				- {{title}} represents the title of the note
				- {{date}} will be replaced with the current date
				- {{content}} is where your generated content will be placed

				Here is the template you will be working with:

				<template>
				${this.templateFileContent}
				</template>

				Your task is to generate ONLY the content that will replace {{content}} in the template. Do not include any other parts of the template in your response. It's crucial that you do not repeat or use any of the template syntax ({{title}}, {{date}}, or {{content}}) in your generated content.

				When creating your content, consider the following:
				1. The overall structure and tone of the template
				2. How your content will fit within the template's context

				Tailor your response to complement the template, ensuring it flows naturally when inserted into the {{content}} section.

				Remember:
				- Do not include any part of the template in your response
				- Do not use the template syntax ({{title}}, {{date}}, or {{content}}) in your content
				- Focus solely on generating the content that will replace {{content}}

				Ensure that your content is appropriate in length and style to fit seamlessly into the given template.
				`,
				)
			: "";

		context.results.set("templatePrompt", prompt);
	}

	protected async performAction(
		input: z.infer<typeof CreateNoteAction.inputSchema>,
		context: ActionContext,
	): Promise<void> {
		if (context.abortSignal.aborted) {
			throw new Error("Action cancelled");
		}

		logger.debug("Creating note:", { input });

		const noteName = input.noteName.endsWith(".md")
			? input.noteName
			: `${input.noteName}.md`;

		let content = input.content || "";

		const templatePath = context.plugin.settings.DEFAULT_NOTE_TEMPLATE_PATH;
		if (templatePath) {
			const templateFile =
				context.app.vault.getAbstractFileByPath(templatePath);

			if (templateFile instanceof TFile) {
				const templateContent =
					await context.app.vault.cachedRead(templateFile);
				content = renderTemplate(templateContent, {
					title: input.noteName.replace(/\.md$/, ""),
					date: new Date().toISOString(),
					content: content,
				});
			} else {
				logger.warn(`Template file not found: ${templatePath}`);
			}
		}

		const note = await context.app.vault.create(noteName, content);

		openFile(context.app, note, {
			paneType: input.paneType,
			direction: input.direction,
			mode: input.mode,
			focus: input.focus,
		});

		context.results.set(this.id, {
			noteName: input.noteName,
			content: content,
		});
	}
}
