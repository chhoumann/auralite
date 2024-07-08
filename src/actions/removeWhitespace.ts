export function removeWhitespace(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}
