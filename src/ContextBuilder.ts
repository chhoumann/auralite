import { MarkdownView } from "obsidian";
import type OVSPlugin from "./main";
import type { ActionContext } from "./actions/Action";
import type { AIManager } from "./ai";

export class ContextBuilder {
	constructor(private plugin: OVSPlugin) {}

	captureEditorState() {
		const activeView =
			this.plugin.app.workspace.getActiveViewOfType(MarkdownView) ?? undefined;
		const cursor = activeView?.editor.getCursor();

		return {
			activeView: activeView,
			cursor: cursor,
			activeEditor: activeView?.editor,
		};
	}

	build(
		aiManager: AIManager,
		initialInput: Map<string, unknown>,
		editorState: ReturnType<typeof this.captureEditorState>,
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
