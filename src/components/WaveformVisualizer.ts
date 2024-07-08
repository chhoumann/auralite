export class WaveformVisualizer {
	private canvas: HTMLCanvasElement;
	private animationFrameId: number | null = null;

	constructor(
		container: HTMLElement,
		private analyser: AnalyserNode,
	) {
		this.canvas = container.createEl("canvas", {
			attr: { width: "200", height: "40" },
		});
		this.canvas.style.display = "block";
		this.canvas.style.margin = "10px auto 0";
	}

	start() {
		this.draw();
	}

	stop() {
		if (this.animationFrameId !== null) {
			cancelAnimationFrame(this.animationFrameId);
			this.animationFrameId = null;
		}
	}

	private draw = () => {
		this.animationFrameId = requestAnimationFrame(this.draw);

		const bufferLength = this.analyser.frequencyBinCount;
		const dataArray = new Uint8Array(bufferLength);
		this.analyser.getByteTimeDomainData(dataArray);

		const canvasCtx = this.canvas.getContext("2d");
		if (!canvasCtx) return;

		canvasCtx.clearRect(0, 0, this.canvas.width, this.canvas.height);

		canvasCtx.lineWidth = 2;
		canvasCtx.strokeStyle = "rgba(65, 105, 225, 0.8)"; // Royal Blue with slight transparency

		canvasCtx.beginPath();

		const sliceWidth = (this.canvas.width * 1.0) / bufferLength;
		let x = 0;

		for (let i = 0; i < bufferLength; i++) {
			const v = dataArray[i] / 128.0;
			const y = (v * this.canvas.height) / 2;

			if (i === 0) {
				canvasCtx.moveTo(x, y);
			} else {
				canvasCtx.lineTo(x, y);
			}

			x += sliceWidth;
		}

		canvasCtx.stroke();
	};
}
