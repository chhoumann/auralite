import { logger } from "@/logging";
import { removeWhitespace } from "@/utils";
import { type Editor, MarkdownView, type TFile } from "obsidian";
import type { ChatCompletion } from "openai/resources";
import { merge } from "three-way-merge";
import { z } from "zod";
import { Action, type ActionContext } from "./Action";

const prompt = removeWhitespace(`
    You are an AI assistant tasked with updating a file's content based on specific instructions. This task requires precision and attention to detail to ensure that only the relevant parts of the file are modified while maintaining the integrity of the rest of the content.

    Here is the original content of the file:

    <original_content>
    {{currentFileContent}}
    </original_content>

    Your task is to update this file according to the following instructions:

    <update_instructions>
    {{userInput}}
    </update_instructions>

    Follow these steps to complete the task:

    1. Carefully analyze the original content and the update instructions.
    2. Identify the specific region in the original content that needs to be updated. Look for unique identifiers, section headers, or contextual clues mentioned in the update instructions. If you're unsure, use a <thinking> tag to explain your reasoning.
    3. Determine the most appropriate method for the update:
        a. If it's a simple replacement, identify the exact text to be replaced.
        b. If it's an insertion, find the precise location where the new content should be added.
        c. If it's a deletion, locate the exact text to be removed.
    4. Make the necessary changes to the original content:
        a. For replacements: Replace the old text with the new content.
        b. For insertions: Add the new content at the identified location.
        c. For deletions: Remove the specified text.
    5. Review the changes to ensure they align with the update instructions and maintain the overall structure and formatting of the file.
    6. If you encounter any ambiguities or challenges during the process, explain your thoughts and decision-making process using a <thinking> tag.
    7. Once you have completed the update, provide the entire updated file content within <updated_content> tags. Ensure that the updated content includes all the original text that was not modified, as well as the newly updated sections.

    Remember to maintain the original formatting, indentation, and structure of the file as much as possible, unless the update instructions specifically require changes to these elements.
    It is crucial that you do not make any edits the user did not ask for.
`);

export class EditAction extends Action<typeof EditAction.inputSchema> {
	readonly description: string =
		"Edit the currently open file. Used when user asks for a specific change to be made.";

	static inputSchema = z.object({
		never: z.never(),
	});

	private activeEditor?: Editor;
	private file?: TFile;
	private fileContent?: string;

	constructor() {
		super("edit", EditAction.inputSchema, prompt, false, false);
	}

	protected override async preExecute(context: ActionContext): Promise<void> {
		const file = context.app.workspace.getActiveFile();

		if (!file) {
			throw new Error("No active file");
		}

		const view = context.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) {
			throw new Error("No active view");
		}

		this.activeEditor = view.editor;
		this.file = file;

		const fileContent = await context.app.vault.cachedRead(file);
		this.fileContent = fileContent;

		context.results.set("currentFileContent", fileContent);
		logger.debug("preExecute", {
			fileContent,
		});
	}

	protected override async performAction(
		input: ChatCompletion,
		context: ActionContext,
	): Promise<void> {
		const content = input.choices[0].message.content;
		if (!content) {
			throw new Error("No content found");
		}

		const updatedContent = this.extractUpdatedContent(content);
		if (!updatedContent) {
			throw new Error("No updated content found");
		}

		await this.applyChanges(updatedContent, context);
	}

	private extractUpdatedContent(responseContent: string): string | null {
		const match = responseContent.match(
			/<updated_content>([\s\S]*?)<\/updated_content>/,
		);

		logger.debug("Extracted updated content", { match });

		return match ? match[1].trim() : null;
	}

	private async applyChanges(
		updatedContent: string,
		context: ActionContext,
	): Promise<void> {
		if (!this.activeEditor || !this.file || this.fileContent === undefined) {
			throw new Error("Active editor or file not available");
		}

		const secondFileRead = await context.app.vault.read(this.file);

		const res = merge(secondFileRead, this.fileContent, updatedContent);
		if (!res.isSuccess()) {
			throw new Error(
				"File has updated since we started editing, and we can't merge in the changes automatically",
			);
		}

		logger.debug("Applying changes", {
			updatedContent,
			fileContent: this.fileContent,
			res: res.joinedResults(),
		});

		await context.app.vault.modify(this.file, res.joinedResults() as string);
	}
}
