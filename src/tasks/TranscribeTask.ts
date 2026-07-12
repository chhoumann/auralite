import type { AudioRecording } from "@/AudioRecorder";
import type { EditorState } from "@/actions/Action";
import { FloatingBar } from "@/components/FloatingBar";
import { WaveformVisualizer } from "@/components/WaveformVisualizer";
import { logger } from "@/logging";
import { appendRecordingEmbed } from "@/recordings";
import { delay } from "@/utils";
import { Task } from "./Task";

export class TranscribeTask extends Task {
	private editorState: Partial<EditorState> | undefined;
	private floatingBar: FloatingBar | null = null;
	private waveformVisualizer: WaveformVisualizer | null = null;

	override async start() {
		super.start();
		await this.audioRecorder.start();
	}

	override stop(): void {
		this.audioRecorder.stop();
	}

	override cancel() {
		super.cancel();
		this.plugin.cancelOngoingOperation();
	}

	override finish() {
		super.finish();
		this.waveformVisualizer?.stop();
		this.floatingBar?.hide();
	}

	protected setupEventListeners() {
		this.addEvent(
			this.audioRecorder,
			"recordingStarted",
			this.handleRecordingStarted.bind(this),
		);

		this.addEvent(this.audioRecorder, "error", async () => {
			this.status = "error";
			this.floatingBar?.setStatus("Error recording");
			await delay(3000);
			this.finish();
		});

		this.addEvent(
			this.audioRecorder,
			"recordingStopped",
			this.handleRecordingStopped.bind(this),
		);

		this.addEvent(
			this.audioRecorder,
			"recordingComplete",
			this.handleRecordingComplete.bind(this),
		);
	}

	protected async handleRecordingStarted() {
		this.floatingBar = new FloatingBar(this.plugin.app.workspace.containerEl);
		const analyser = this.audioRecorder.getAnalyser();
		if (!analyser) {
			throw new Error("Analyser is undefined");
		}

		this.waveformVisualizer = new WaveformVisualizer(
			this.floatingBar.waveformContainer,
			analyser,
		);
		this.waveformVisualizer.start();

		this.floatingBar.show();
	}

	protected async handleRecordingStopped() {
		this.waveformVisualizer?.stop();
		this.floatingBar?.setStatus("Finished recording");
	}

	protected async handleRecordingComplete(recording: AudioRecording) {
		try {
			this.editorState = await this.contextBuilder.captureEditorState();
			if (!this.editorState.cursor || !this.editorState.activeEditor) {
				throw new Error("No cursor or active editor found");
			}

			let recordingEmbed: string | undefined;
			if (this.plugin.settings.SAVE_AUDIO_RECORDINGS) {
				recordingEmbed = await this.plugin.saveAudioRecording(
					recording,
					this.editorState.currentFile?.path,
				);
			}

			this.floatingBar?.setStatus("Transcribing...");
			const transcription = await this.aiManager.transcribeAudio(recording);
			const content = appendRecordingEmbed(transcription, recordingEmbed);

			this.editorState.activeEditor.replaceRange(
				content,
				this.editorState.cursor,
			);
			this.floatingBar?.setStatus("Added to editor");
		} catch (error) {
			logger.error("Error handling completed recording:", { error });
			this.status = "error";
			this.floatingBar?.setStatus("Error transcribing");
		} finally {
			await delay(3000);
			this.finish();
		}
	}
}
