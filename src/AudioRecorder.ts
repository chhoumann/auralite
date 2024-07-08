// biome-ignore lint/style/useNodejsImportProtocol: not using it here.
import EventEmitter from "events";

interface AudioRecorderEvents {
	dataAvailable: (data: Blob) => void;
	recordingComplete: (buffer: ArrayBuffer) => void;
	recordingStarted: () => void;
	recordingStopped: () => void;
	recordingCancelled: (error: Error) => void;
	teardown: () => void;
	error: (error: unknown) => void;
}

export class AudioRecorder extends EventEmitter {
	private mediaRecorder: MediaRecorder | null = null;
	private audioChunks: Blob[] = [];
	private recordingPromise: Promise<ArrayBuffer> | null = null;
	private resolveRecording: ((value: ArrayBuffer) => void) | null = null;
	private rejectRecording: ((reason: unknown) => void) | null = null;

	private handleDataAvailable = (event: BlobEvent) => {
		this.audioChunks.push(event.data);
		this.emit("dataAvailable", event.data);
	};

	private handleStop = () => {
		const audioBlob = new Blob(this.audioChunks, { type: "audio/wav" });
		audioBlob.arrayBuffer().then((buffer) => {
			if (this.resolveRecording) {
				this.resolveRecording(buffer);
				this.emit("recordingComplete", buffer);
			}
		});
	};

	teardown() {
		this.emit("teardown");
		this.removeAllListeners();
		if (this.mediaRecorder) {
			this.mediaRecorder.removeEventListener(
				"dataavailable",
				this.handleDataAvailable,
			);
			this.mediaRecorder.removeEventListener("stop", this.handleStop);
			for (const track of this.mediaRecorder.stream.getTracks()) {
				track.stop();
			}
			this.mediaRecorder = null;
		}
		this.audioChunks = [];
		this.recordingPromise = null;
		this.resolveRecording = null;
		this.rejectRecording = null;
	}

	async start(): Promise<void> {
		if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
			throw new Error("Recording is already in progress");
		}

		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			this.mediaRecorder = new MediaRecorder(stream);
			this.audioChunks = [];

			this.mediaRecorder.addEventListener(
				"dataavailable",
				this.handleDataAvailable,
			);
			this.mediaRecorder.addEventListener("stop", this.handleStop);

			this.recordingPromise = new Promise((resolve, reject) => {
				this.resolveRecording = resolve;
				this.rejectRecording = reject;
			});

			this.mediaRecorder.start();
			this.emit("recordingStarted");
		} catch (error) {
			console.error("Error starting recording:", error);
			this.emit("error", error);
			throw error;
		}
	}

	stop(): Promise<ArrayBuffer> {
		if (!this.mediaRecorder || this.mediaRecorder.state !== "recording") {
			const error = new Error("No active recording to stop");
			this.emit("error", error);
			return Promise.reject(error);
		}

		this.mediaRecorder.stop();
		this.emit("recordingStopped");
		return (
			this.recordingPromise ??
			Promise.reject(new Error("Recording promise not initialized"))
		);
	}

	cancel(): void {
		if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
			this.mediaRecorder.stop();
			if (this.rejectRecording) {
				const error = new Error("Recording cancelled");
				this.rejectRecording(error);
				this.emit("recordingCancelled", error);
			}
		}
		this.teardown();
	}

	isRecording(): boolean {
		return (
			this.mediaRecorder !== null && this.mediaRecorder.state === "recording"
		);
	}

	override on<K extends keyof AudioRecorderEvents>(
		event: K,
		listener: AudioRecorderEvents[K],
	): this {
		return super.on(event, listener);
	}

	override emit<K extends keyof AudioRecorderEvents>(
		event: K,
		...args: Parameters<AudioRecorderEvents[K]>
	): boolean {
		return super.emit(event, ...args);
	}
}
