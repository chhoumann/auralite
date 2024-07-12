export class FloatingBar {
	private container: HTMLElement;
	private bar: HTMLElement;
	public _waveformContainer: HTMLElement;
	private statusContainer: HTMLElement;

	public get waveformContainer(): HTMLElement {
		return this._waveformContainer;
	}

	constructor(parentElement: HTMLElement) {
		this.container = parentElement.createEl("div", {
			cls: "ovs-floating-bar-container",
		});
		this.bar = this.container.createEl("div", { cls: "ovs-floating-bar" });
		this._waveformContainer = this.bar.createEl("div", {
			cls: "ovs-waveform-container",
		});
		this.statusContainer = this.bar.createEl("div", {
			cls: "ovs-status-container",
		});

		this.hide(true);
	}

	public show() {
		this.resetForNewRecording();
		this.container.style.display = "flex";
		setTimeout(() => this.container.addClass("visible"), 10);
	}
	public hide(immediate: boolean = false) {
		this.container.removeClass("visible");
		if (immediate) {
			this.container.style.display = "none";
			this.statusContainer.empty();
		} else {
			setTimeout(() => {
				this.container.style.display = "none";
				this.statusContainer.empty();
			}, 300);
		}
	}

	private statusQueue: string[] = [];
	private isProcessingQueue = false;

	public setStatus(message: string) {
		this.statusQueue.push(message);
		this.processStatusQueue();
	}

	private async processStatusQueue() {
		if (this.isProcessingQueue) return;
		this.isProcessingQueue = true;

		while (this.statusQueue.length > 0) {
			const status = this.statusQueue.shift();
			if (status) {
				this._waveformContainer.style.display = "none";
				this.statusContainer.style.display = "block";
				this.statusContainer.innerHTML = status.replace(/\n/g, "<br>");
				await new Promise((resolve) => setTimeout(resolve, 500));
			}
		}

		this.isProcessingQueue = false;
	}

	public resetForNewRecording() {
		this._waveformContainer.style.display = "block";
		this.statusContainer.style.display = "none";
		this.statusContainer.empty();
	}

	public remove() {
		this.container.remove();
	}
}
