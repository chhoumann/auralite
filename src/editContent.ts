import { merge } from "node-diff3";

/**
 * Returns the file content between the <updated_content> tags. The line
 * breaks that separate the content from the tags are dropped, and the
 * original file's final line break is kept, so an edit never adds or removes
 * one.
 */
export function extractUpdatedContent(
	response: string,
	original: string,
): string | null {
	const match = response.match(
		/<updated_content>\r?\n?([\s\S]*?)\r?\n?<\/updated_content>/,
	);
	if (!match) return null;
	return match[1] + (original.match(/\r?\n$/)?.[0] ?? "");
}

/**
 * Applies the model's rewrite of `base` to `current`, the file as it is now.
 * Returns null when the user changed the same lines.
 */
export function mergeEdit(
	current: string,
	base: string,
	updated: string,
): string | null {
	const res = merge(current, base, updated, { stringSeparator: "\n" });
	return res.conflict ? null : res.result.join("\n");
}
