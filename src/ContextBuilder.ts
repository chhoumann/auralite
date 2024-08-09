import type { ActionContext, EditorState } from "@/actions/Action";
import type { AIManager } from "@/ai";
import type AuralitePlugin from "@/main";
import { MarkdownView, TFile } from "obsidian";

async function getActiveFileFormatted(plugin: AuralitePlugin) {
	const file = plugin.app.workspace.getActiveFile();

	if (!file || !(file instanceof TFile)) {
		return undefined;
	}

	return { name: file.name, content: await plugin.app.vault.cachedRead(file) };
}

export class ContextBuilder {
	constructor(private plugin: AuralitePlugin) {}

	async captureEditorState(): Promise<Partial<EditorState>> {
		const activeView =
			this.plugin.app.workspace.getActiveViewOfType(MarkdownView) ?? undefined;
		const cursor = activeView?.editor.getCursor();
		const line = cursor?.line;
		const currentSelection = activeView?.editor.getSelection();

		return {
			activeView: activeView,
			cursor: cursor,
			activeEditor: activeView?.editor,
			currentFile: await getActiveFileFormatted(this.plugin),
			currentLine: line ? activeView?.editor.getLine(line) : undefined,
			currentSelection: currentSelection ? currentSelection : undefined,
		};
	}

	build(
		aiManager: AIManager,
		initialInput: Map<string, unknown>,
		editorState: Partial<EditorState>,
	): ActionContext {
		return {
			app: this.plugin.app,
			plugin: this.plugin,
			oai: aiManager.getOpenAI(),
			ai: aiManager,
			client: aiManager.getInstructorClient(),
			results: initialInput,
			abortSignal: new AbortController().signal,
			state: {
				editor: editorState,
			},
		};
	}
}
