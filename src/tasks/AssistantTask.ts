import type { EditorState } from "@/actions/Action";
import { FloatingBar } from "@/components/FloatingBar";
import { WaveformVisualizer } from "@/components/WaveformVisualizer";
import { logger } from "@/logging";
import { delay } from "@/utils";
import { Task } from "./Task";

declare const __IS_DEV__: boolean;

export class AssistantTask extends Task {
	private editorState: Partial<EditorState> | undefined;
	private audioData: { buffer: ArrayBuffer; mimeType: string } | null = null;
	private floatingBar: FloatingBar | null = null;
	private waveformVisualizer: WaveformVisualizer | null = null;

	override start() {
		super.start();
		this.audioRecorder.start();
	}

	override stop() {
		super.stop();
		this.audioRecorder.stop();
	}

	override finish() {
		super.finish();
		this.waveformVisualizer?.stop();
		this.floatingBar?.hide();
	}

	override cancel() {
		super.cancel();
		this.waveformVisualizer?.stop();
		this.audioRecorder.cancel();
		this.floatingBar?.remove();
		this.aiManager.cancel();
	}

	protected setupEventListeners() {
		this.addEvent(
			this.audioRecorder,
			"recordingStarted",
			this.handleRecordingStarted.bind(this),
		);

		this.addEvent(
			this.audioRecorder,
			"recordingComplete",
			this.handleRecordingComplete.bind(this),
		);

		this.addEvent(this.aiManager, "transcriptionComplete", (transcription) => {
			this.floatingBar?.setStatus(
				`Transcription: "${transcription.substring(0, 30)}..."`,
			);
		});

		this.addEvent(this.aiManager, "processingStarted", () => {
			this.floatingBar?.setStatus("Assistant is thinking...");
		});

		this.addEvent(this.aiManager, "actionPlanned", (action, contexts) => {
			this.floatingBar?.setStatus(
				`Planning action: ${action}\nContexts: ${contexts.join(", ")}`,
			);
		});

		this.addEvent(this.aiManager, "actionExecutionStarted", (action) => {
			this.floatingBar?.setStatus(`Executing action: ${action}`);
		});

		this.addEvent(this.aiManager, "actionExecutionComplete", (action) => {
			this.floatingBar?.setStatus(`Completed action: ${action}`);
		});

		this.addEvent(this.aiManager, "processingComplete", async () => {
			this.floatingBar?.hide();
		});

		this.addEvent(this.aiManager, "error", (error) => {
			this.floatingBar?.setStatus(`Error: ${error.message}`);
			this.status = "error";
			setTimeout(() => this.floatingBar?.hide(), 5000);
		});

		this.addEvent(
			this.aiManager,
			"transcriptionComplete",
			this.handleTranscriptionComplete.bind(this),
		);
	}

	protected handleRecordingStarted() {
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

	protected async handleRecordingComplete(data: {
		buffer: ArrayBuffer;
		mimeType: string;
	}) {
		this.audioData = data;
		this.editorState = await this.contextBuilder.captureEditorState();

		this.waveformVisualizer?.stop();

		if (!this.audioData) {
			logger.error("audioData is undefined");
			this.floatingBar?.setStatus("Failed to get recording data");
			return;
		}

		this.floatingBar?.setStatus("Transcribing...");
		this.aiManager.transcribeAudio(this.audioData);
	}

	protected async handleTranscriptionComplete(transcription: string) {
		try {
			if (__IS_DEV__) {
				await this.plugin.saveTranscriptionForDev(transcription);
			}

			if (!this.editorState) {
				throw new Error("EditorState is undefined");
			}

			await this.aiManager.run(transcription, this.editorState);
		} catch (error) {
			logger.error("Failed to transcribe", { error });
			this.floatingBar?.setStatus("Failed to transcribe");
		} finally {
			await delay(3000);
			this.finish();
		}
	}
}
