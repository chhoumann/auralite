import { TypedEvents } from "@/types/TypedEvents";

export interface SilenceDetectionOptions {
	silenceThreshold: number;
	silenceDuration: number;
}

interface SilenceDetectionEvents {
	silenceDetected: () => void;
}

export class SilenceDetection extends TypedEvents<SilenceDetectionEvents> {
	private silenceThreshold: number;
	private silenceDuration: number;
	private silenceTimer: ReturnType<typeof setTimeout> | null = null;
	private analyser: AnalyserNode | null = null;

	constructor(options: SilenceDetectionOptions) {
		super();
		this.silenceThreshold = options.silenceThreshold;
		this.silenceDuration = options.silenceDuration;
	}

	setAnalyser(analyser: AnalyserNode) {
		this.analyser = analyser;
	}

	start() {
		if (!this.analyser) {
			throw new Error("Analyser not set");
		}

		const bufferLength = this.analyser.frequencyBinCount;
		const dataArray = new Uint8Array(bufferLength);

		const checkSilence = () => {
			if (!this.analyser) return;

			this.analyser.getByteFrequencyData(dataArray);
			const average =
				dataArray.reduce((sum, value) => sum + value, 0) / bufferLength;
			const normalizedAverage = average / 255;

			if (normalizedAverage < this.silenceThreshold) {
				this.startSilenceTimer();
			} else {
				this.resetSilenceTimer();
			}

			requestAnimationFrame(checkSilence);
		};

		requestAnimationFrame(checkSilence);
	}

	stop() {
		this.resetSilenceTimer();
	}

	private startSilenceTimer() {
		if (this.silenceTimer) return;

		this.silenceTimer = setTimeout(() => {
			this.trigger("silenceDetected");
		}, this.silenceDuration);
	}

	private resetSilenceTimer() {
		if (this.silenceTimer) {
			clearTimeout(this.silenceTimer);
			this.silenceTimer = null;
		}
	}

	updateOptions(options: Partial<SilenceDetectionOptions>) {
		if (options.silenceThreshold !== undefined) {
			this.silenceThreshold = options.silenceThreshold;
		}
		if (options.silenceDuration !== undefined) {
			this.silenceDuration = options.silenceDuration;
		}
	}
}
