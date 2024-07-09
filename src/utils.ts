import type { Editor, EditorPosition } from "obsidian";
import { ActionContext } from "./actions/Action";
import type { ChatCompletionChunk } from "openai/resources";
import type { Stream } from "openai/streaming";
import type { z } from "zod";

export function createStreamingInserter(
	editor: Editor,
	initialCursor: EditorPosition,
) {
	const lastCursor = { ...initialCursor };

	return function insertStreamedContent(chunk: string) {
		const lines = chunk.split(/\r\n|\n|\r/);
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
export async function getOpenAIStreamProcessor({
	stream,
	context,
}: {
	stream: Stream<ChatCompletionChunk>;
	context: ActionContext;
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
