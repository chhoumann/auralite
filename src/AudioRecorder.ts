import { type EventRef, Events } from "obsidian";

interface AudioRecorderEvents {
	dataAvailable: (data: Blob) => void;
	recordingComplete: (buffer: ArrayBuffer) => void;
	recordingStarted: () => void;
	recordingStopped: () => void;
	recordingCancelled: (error: Error) => void;
	teardown: () => void;
	error: (error: unknown) => void;
}

export class AudioRecorder extends Events {
	private mediaRecorder: MediaRecorder | null = null;
	private audioChunks: Blob[] = [];
	private recordingPromise: Promise<ArrayBuffer> | null = null;
	private resolveRecording: ((value: ArrayBuffer) => void) | null = null;
	private rejectRecording: ((reason: unknown) => void) | null = null;

	private handleDataAvailable = (event: BlobEvent) => {
		this.audioChunks.push(event.data);
		this.trigger("dataAvailable", event.data);
	};

	private handleStop = () => {
		const audioBlob = new Blob(this.audioChunks, { type: "audio/wav" });
		audioBlob.arrayBuffer().then((buffer) => {
			if (this.resolveRecording) {
				this.resolveRecording(buffer);
				this.trigger("recordingComplete", buffer);
			}
		});
	};

	teardown() {
		this.trigger("teardown");
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
			this.trigger("recordingStarted");
		} catch (error) {
			console.error("Error starting recording:", error);
			this.trigger("error", error);
			throw error;
		}
	}

	stop(): Promise<ArrayBuffer> {
		if (!this.mediaRecorder || this.mediaRecorder.state !== "recording") {
			const error = new Error("No active recording to stop");
			this.trigger("error", error);
			return Promise.reject(error);
		}

		this.mediaRecorder.stop();
		this.trigger("recordingStopped");
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
				this.trigger("recordingCancelled", error);
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
		callback: AudioRecorderEvents[K],
		ctx?: unknown,
	): EventRef {
		return super.on(event, callback, ctx);
	}

	override off<K extends keyof AudioRecorderEvents>(
		event: K,
		callback: AudioRecorderEvents[K],
	): void {
		super.off(event, callback);
	}

	override trigger<K extends keyof AudioRecorderEvents>(
		event: K,
		...args: Parameters<AudioRecorderEvents[K]>
	): void {
		super.trigger(event, ...args);
	}
}
