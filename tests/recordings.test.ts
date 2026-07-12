import { describe, expect, test } from "bun:test";
import {
	appendRecordingEmbed,
	createRecordingFilename,
} from "../src/recordings";

describe("recording attachments", () => {
	test("creates a filesystem-safe local timestamped filename", () => {
		const recordedAt = new Date(2026, 6, 12, 9, 5, 3);

		expect(
			createRecordingFilename(
				{ buffer: new ArrayBuffer(0), fileExtension: "webm" },
				recordedAt,
			),
		).toBe("Auralite recording 2026-07-12 09-05-03.webm");
	});

	test("embeds a saved recording after the transcript", () => {
		expect(appendRecordingEmbed("Spoken thought.\n", "![[recording.webm]]")).toBe(
			"Spoken thought.\n\n![[recording.webm]]",
		);
	});

	test("leaves the transcript unchanged when saving is disabled", () => {
		expect(appendRecordingEmbed("Spoken thought.")).toBe("Spoken thought.");
	});
});
