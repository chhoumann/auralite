import { basicSetup } from "@codemirror/basic-setup";
import { markdown } from "@codemirror/lang-markdown";
import { MergeView } from "@codemirror/merge";
import { EditorView } from "@codemirror/view";
import { ItemView, MarkdownRenderer, setIcon } from "obsidian";
import type { WorkspaceLeaf as ObsidianWorkspaceLeaf } from "obsidian";

export const DIFF_REVIEW_VIEW_TYPE = "auralite-diff-review-view";

export class DiffReviewView extends ItemView {
	private original: string;
	private updated: string;
	private onAccept: () => void;
	private onReject: () => void;
	private cmView: EditorView | null = null;
	private mergeView: MergeView | null = null;
	private previewMode: boolean = false;

	constructor(
		leaf: ObsidianWorkspaceLeaf,
		original: string,
		updated: string,
		onAccept: () => void,
		onReject: () => void,
	) {
		super(leaf);
		this.original = original;
		this.updated = updated;
		this.onAccept = onAccept;
		this.onReject = onReject;
	}

	getViewType() {
		return DIFF_REVIEW_VIEW_TYPE;
	}

	getDisplayText() {
		return "Review File Changes";
	}

	override async onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		// Header and toggle
		const header = contentEl.createEl("div", { cls: "auralite-diff-header" });
		header.createEl("h2", { text: "Review File Changes" });

		const toggle = header.createEl("button", { cls: "auralite-diff-toggle" });
		setIcon(toggle, this.previewMode ? "file-code" : "lucide-eye");
		toggle.title = this.previewMode
			? "Show Source Diff"
			: "Show Markdown Preview";
		toggle.onclick = () => {
			this.previewMode = !this.previewMode;
			setIcon(toggle, this.previewMode ? "file-code" : "lucide-eye");
			toggle.title = this.previewMode
				? "Show Source Diff"
				: "Show Markdown Preview";
			this.renderDiffOrPreview();
		};

		// Diff/preview container
		const diffContainer = contentEl.createEl("div", {
			cls: "auralite-diff-cm6-container",
		});
		this.diffContainer = diffContainer;
		this.renderDiffOrPreview();

		// Action buttons
		const actions = contentEl.createEl("div", { cls: "auralite-diff-actions" });
		const acceptBtn = actions.createEl("button", {
			text: "Accept Changes",
			cls: "mod-cta",
		});
		const rejectBtn = actions.createEl("button", { text: "Reject Changes" });

		acceptBtn.onclick = () => {
			this.onAccept();
			this.leaf.detach();
		};
		rejectBtn.onclick = () => {
			this.onReject();
			this.leaf.detach();
		};
	}

	private diffContainer: HTMLElement | null = null;

	private renderDiffOrPreview() {
		if (!this.diffContainer) return;
		this.diffContainer.empty();

		if (this.previewMode) {
			this.diffContainer.addClass("auralite-diff-preview-mode");
			const previewWrapper = this.diffContainer.createEl("div", {
				cls: "auralite-diff-preview-wrapper",
			});
			const beforeCol = previewWrapper.createEl("div", {
				cls: "auralite-diff-preview-col scroll-sync",
			});
			const afterCol = previewWrapper.createEl("div", {
				cls: "auralite-diff-preview-col scroll-sync",
			});
			beforeCol.createEl("div", {
				text: "Before",
				cls: "auralite-diff-preview-label",
			});
			afterCol.createEl("div", {
				text: "After",
				cls: "auralite-diff-preview-label",
			});
			MarkdownRenderer.renderMarkdown(this.original, beforeCol, "", this);
			MarkdownRenderer.renderMarkdown(this.updated, afterCol, "", this);

			// --- Scroll sync logic ---
			let isSyncing = false;
			const syncScroll = (source: HTMLElement, target: HTMLElement) => {
				if (isSyncing) return;
				isSyncing = true;
				target.scrollTop = source.scrollTop;
				isSyncing = false;
			};
			beforeCol.addEventListener("scroll", () =>
				syncScroll(beforeCol, afterCol),
			);
			afterCol.addEventListener("scroll", () =>
				syncScroll(afterCol, beforeCol),
			);
		} else {
			this.diffContainer.removeClass("auralite-diff-preview-mode");
			// Render CodeMirror merge (diff) view
			if (this.mergeView) {
				this.mergeView.destroy();
				this.mergeView = null;
			}
			this.mergeView = new MergeView({
				a: {
					doc: this.original,
					extensions: [basicSetup, markdown(), EditorView.editable.of(false)],
				},
				b: {
					doc: this.updated,
					extensions: [basicSetup, markdown(), EditorView.editable.of(false)],
				},
				highlightChanges: true,
				// EditorView.theme({ ... }) can be added to both a/b if desired
			});
			this.diffContainer.appendChild(this.mergeView.dom);
			console.log("MergeView DOM appended", this.mergeView.dom);

			// --- Make MergeView fill 80% of vertical space and sync scroll ---
			this.diffContainer.style.height = "80vh";
			this.mergeView.dom.style.height = "80vh";
			this.mergeView.dom.style.maxHeight = "80vh";
			this.mergeView.dom.style.minHeight = "0";

			// Find the left and right editor scroll containers
			const left = this.mergeView.dom.querySelector(
				".cm-merge-a .cm-scroller",
			) as HTMLElement;
			const right = this.mergeView.dom.querySelector(
				".cm-merge-b .cm-scroller",
			) as HTMLElement;
			if (left && right) {
				let isSyncing = false;
				const syncScroll = (source: HTMLElement, target: HTMLElement) => {
					if (isSyncing) return;
					isSyncing = true;
					target.scrollTop = source.scrollTop;
					isSyncing = false;
				};
				left.addEventListener("scroll", () => syncScroll(left, right));
				right.addEventListener("scroll", () => syncScroll(right, left));
			}
		}
	}

	override async onClose() {
		this.cmView?.destroy();
		this.cmView = null;
		if (this.mergeView) {
			this.mergeView.destroy();
			this.mergeView = null;
		}
		this.diffContainer = null;
		this.contentEl.empty();
	}
}
