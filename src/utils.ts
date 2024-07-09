import type { Editor, EditorPosition } from "obsidian";

export function createStreamingInserter(
	editor: Editor,
	initialCursor: EditorPosition,
) {
	const lastCursor = { ...initialCursor };

	return function insertStreamedContent(chunk: string) {
		const lines = chunk.split("\n");
		if (lines.length > 1) {
			const uniqueLines = lines.filter(
				(line, index, array) => line !== array[index - 1],
			);

			for (const line of uniqueLines) {
				editor.replaceRange(`${line}\n`, lastCursor);
				lastCursor.line++;
				lastCursor.ch = 0;
			}
		} else {
			editor.replaceRange(chunk, lastCursor);
			lastCursor.ch += chunk.length;
		}
	};
}

export function removeWhitespace(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}
