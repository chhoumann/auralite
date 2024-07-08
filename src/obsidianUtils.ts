import type { App, PaneType, SplitDirection, TFile } from "obsidian";

export type FileViewMode = "source" | "preview" | "default";

export async function openFile(
	app: App,
	file: TFile,
	optional: {
		paneType?: PaneType;
		direction?: SplitDirection;
		mode?: FileViewMode;
		focus?: boolean;
	} = {},
) {
	const { paneType = "tab", direction, mode, focus = true } = optional;

	const leaf =
		paneType === "split"
			? app.workspace.getLeaf(paneType, direction)
			: app.workspace.getLeaf(paneType);

	await leaf.openFile(file, { active: focus });

	if (mode) {
		await leaf.setViewState({
			type: leaf.view.getViewType(),
			state: { ...leaf.view.getState(), mode },
		});
	}
}
