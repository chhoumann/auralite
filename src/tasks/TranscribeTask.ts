import type { EditorState } from "@/actions/Action";
import { FloatingBar } from "@/components/FloatingBar";
import { WaveformVisualizer } from "@/components/WaveformVisualizer";
import { logger } from "@/logging";
import { delay } from "@/utils";
import { Task } from "./Task";

export class TranscribeTask extends Task {
	private editorState: Partial<EditorState> | undefined;
	private audioData: { buffer: ArrayBuffer; mimeType: string } | null = null;
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
		this.editorState = await this.contextBuilder.captureEditorState();
		this.waveformVisualizer?.stop();
		this.floatingBar?.setStatus("Finished recording");
	}

	protected async handleRecordingComplete(data: {
		buffer: ArrayBuffer;
		mimeType: string;
	}) {
		try {
			this.audioData = data;

			if (!this.editorState || !this.audioData) {
				throw new Error("No editor state or audio data found");
			}

			this.floatingBar?.setStatus("Transcribing...");
			const transcription = await this.aiManager.transcribeAudio(
				this.audioData,
			);

			if (this.editorState.cursor && this.editorState.activeEditor) {
				this.editorState.activeEditor.replaceRange(transcription, {
					line: this.editorState.cursor?.line,
					ch: this.editorState.cursor?.ch,
				});

				this.floatingBar?.setStatus("Added to editor");
			} else {
				this.floatingBar?.setStatus("No cursor or active editor found");
			}
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
