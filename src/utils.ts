import type { Editor, EditorPosition } from "obsidian";
import type { ChatCompletionChunk } from "openai/resources";
import type { Stream } from "openai/streaming";
import type { z } from "zod";
import type { ActionContext } from "./actions/Action";

export function createStreamingInserter(
	editor: Editor,
	initialCursor: EditorPosition,
	options: Partial<{
		setCursor: (cursor: EditorPosition) => void;
		bufferSize: number;
	}> = { bufferSize: 100 },
) {
	const lastCursor = { ...initialCursor };
	let buffer = "";
	const bufferSize = options.bufferSize ?? 100;

	function insertBuffer() {
		if (buffer.length > 0) {
			editor.replaceRange(buffer, lastCursor);
			lastCursor.ch += buffer.length;
			buffer = "";
			return true;
		}
		return false;
	}

	return {
		insertStreamedContent(chunk: string) {
			buffer += chunk;
			const lines = buffer.split("\n");

			if (lines.length > 1) {
				for (let i = 0; i < lines.length - 1; i++) {
					editor.replaceRange(`${lines[i]}\n`, lastCursor);
					lastCursor.line++;
					lastCursor.ch = 0;
				}
				buffer = lines[lines.length - 1];
			}

			if (buffer.length > bufferSize) {
				insertBuffer();
			}

			options.setCursor?.(lastCursor);
		},
		flush() {
			insertBuffer();
			options.setCursor?.(lastCursor);
		},
	};
}

export function removeWhitespace(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}
export async function getOpenAIChatStreamProcessor({
	stream,
	abortSignal,
}: {
	stream: Stream<ChatCompletionChunk>;
	abortSignal: AbortSignal;
}): Promise<{
	processor: AsyncGenerator<string, void, unknown>;
	fullContent: { value: string };
}> {
	const fullContent = { value: "" };

	return {
		processor: (async function* streamProcessor() {
			for await (const chunk of stream) {
				if (abortSignal.aborted) {
					throw new Error("Action cancelled");
				}
				const content = chunk.choices[0].delta.content;

				if (content) {
					fullContent.value += content;
					yield content;
				}
			}
		})(),
		fullContent,
	};
}

export async function getInstructorStreamProcessor<
	T extends z.infer<z.AnyZodObject>,
>({
	stream,
	context,
	chunkKey,
}: {
	stream: Stream<T>;
	context: ActionContext;
	chunkKey: keyof z.infer<z.AnyZodObject>;
}): Promise<{
	processor: AsyncGenerator<string, void, unknown>;
	fullContent: { value: string };
}> {
	const fullContent = { value: "" };

	return {
		processor: (async function* streamProcessor() {
			for await (const chunk of stream) {
				if (context.abortSignal.aborted) {
					throw new Error("Action cancelled");
				}

				const chunkValue = chunk[chunkKey as keyof typeof chunk] as string;
				const newContent = chunkValue.slice(fullContent.value.length);
				fullContent.value = chunkValue;
				yield newContent;
			}
		})(),
		fullContent,
	};
}

/**
 * Delays execution for a specified number of milliseconds.
 * @param ms The number of milliseconds to delay.
 * @returns A Promise that resolves after the specified delay.
 */
export function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
