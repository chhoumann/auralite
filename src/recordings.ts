import type { AudioRecording } from "./AudioRecorder";

function pad(value: number): string {
	return value.toString().padStart(2, "0");
}

export function createRecordingFilename(
	recording: AudioRecording,
	recordedAt: Date,
): string {
	const date = [
		recordedAt.getFullYear(),
		pad(recordedAt.getMonth() + 1),
		pad(recordedAt.getDate()),
	].join("-");
	const time = [
		pad(recordedAt.getHours()),
		pad(recordedAt.getMinutes()),
		pad(recordedAt.getSeconds()),
	].join("-");

	return `Auralite recording ${date} ${time}.${recording.fileExtension}`;
}

export function appendRecordingEmbed(
	transcription: string,
	recordingEmbed?: string,
): string {
	if (!recordingEmbed) {
		return transcription;
	}

	return `${transcription.trimEnd()}\n\n${recordingEmbed}`;
}
