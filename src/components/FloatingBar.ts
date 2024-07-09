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

	public setStatus(message: string) {
		this._waveformContainer.style.display = "none";
		this.statusContainer.style.display = "block";
		this.statusContainer.setText(message);
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
