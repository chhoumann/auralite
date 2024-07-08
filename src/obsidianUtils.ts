import type { App, TFile, WorkspaceLeaf } from "obsidian";

export enum NewTabDirection {
	vertical = "vertical",
	horizontal = "horizontal",
}

export type FileViewMode = "source" | "preview" | "default";

export async function openFile(
	app: App,
	file: TFile,
	optional: {
		openInNewTab?: boolean;
		direction?: NewTabDirection;
		mode?: FileViewMode;
		focus?: boolean;
	},
) {
	let leaf: WorkspaceLeaf;

	if (optional.openInNewTab && optional.direction) {
		leaf = app.workspace.getLeaf("split", optional.direction);
	} else {
		leaf = app.workspace.getLeaf("tab");
	}

	await leaf.openFile(file);

	if (optional?.focus) {
		app.workspace.setActiveLeaf(leaf, { focus: optional.focus });
	}

	if (optional?.mode) {
		const leafViewState = leaf.getViewState();

		await leaf.setViewState({
			...leafViewState,
			// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
			state: {
				...leafViewState.state,
				mode: optional.mode,
			},
		});
	}
}
