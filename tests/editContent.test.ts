import { describe, expect, test } from "bun:test";
import { extractUpdatedContent, mergeEdit } from "../src/editContent";

const response = `<thinking>Rename the title.</thinking>
<updated_content>
# New Title

First paragraph.

Last paragraph.
</updated_content>`;

function applyEdit(base: string, current: string, eol = "\n") {
	const updated = extractUpdatedContent(response.replaceAll("\n", eol), base);
	if (updated === null) throw new Error("no updated content");
	return mergeEdit(current, base, updated);
}

describe("applying an edit", () => {
	for (const [name, ending] of [
		["with", "\n"],
		["without", ""],
	]) {
		const base = `# Title\n\nFirst paragraph.\n\nLast paragraph.${ending}`;

		test(`keeps a note ${name} a trailing newline as it was`, () => {
			expect(applyEdit(base, base)).toBe(
				`# New Title\n\nFirst paragraph.\n\nLast paragraph.${ending}`,
			);
		});

		test(`keeps a user edit to the last paragraph of a note ${name} a trailing newline`, () => {
			const current = base.replace(
				"Last paragraph.",
				"Last paragraph, edited.",
			);
			expect(applyEdit(base, current)).toBe(
				`# New Title\n\nFirst paragraph.\n\nLast paragraph, edited.${ending}`,
			);
		});
	}

	test("keeps CRLF line endings", () => {
		const base = "# Title\r\n\r\nFirst paragraph.\r\n\r\nLast paragraph.\r\n";
		const current = base.replace("Last paragraph.", "Last paragraph, edited.");
		expect(applyEdit(base, current, "\r\n")).toBe(
			"# New Title\r\n\r\nFirst paragraph.\r\n\r\nLast paragraph, edited.\r\n",
		);
	});

	test("refuses when the user changed the same line", () => {
		const base = "# Title\n\nFirst paragraph.\n\nLast paragraph.\n";
		expect(applyEdit(base, base.replace("# Title", "# My Title"))).toBeNull();
	});

	test("finds no content without the tags", () => {
		expect(
			extractUpdatedContent("I could not make that change.", ""),
		).toBeNull();
	});
});
