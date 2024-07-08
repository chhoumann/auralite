import { Notice, Plugin, TFile } from "obsidian";
import { AudioRecorder } from "./AudioRecorder";
import {
	DEFAULT_SETTINGS,
	type OVSPluginSettings,
	OVSSettingTab,
} from "./OVSSettingTab";
import { CreateNoteAction, NoopAction } from "./actions/Action";
import { ActionManager } from "./actions/ActionManager";
import { AIManager } from "./ai";
import { registerCommands } from "./commands";

export default class OVSPlugin extends Plugin {
	settings!: OVSPluginSettings;
	actionManager!: ActionManager;

	private audioRecorder: AudioRecorder = new AudioRecorder();
	private aiManager!: AIManager;
	private isRecording = false;

	override async onload() {
		await this.loadSettings();
		this.actionManager = new ActionManager();

		this.actionManager.registerAction(new CreateNoteAction());
		this.actionManager.registerAction(new NoopAction());

		this.aiManager = new AIManager(this, this.actionManager.getAllActionIds());

		registerCommands(this);

		this.addSettingTab(new OVSSettingTab(this.app, this));

		// Replace the existing ribbon icon with a push-to-talk button
		this.addRibbonIcon("mic", "Push to talk", (evt: MouseEvent) => {
			if (evt.type === "mousedown") {
				this.startRecording();
			} else if (evt.type === "mouseup" || evt.type === "mouseleave") {
				this.stopRecording();
			}
		});

		// Add event listeners for the push-to-talk button
		// Register the push-to-talk button
		const ribbonIcon = this.addRibbonIcon("mic", "Push to talk", () => {});
		this.registerDomEvent(
			ribbonIcon,
			"mousedown",
			this.startRecording.bind(this),
		);
		this.registerDomEvent(ribbonIcon, "mouseup", this.stopRecording.bind(this));
		this.registerDomEvent(
			ribbonIcon,
			"mouseleave",
			this.stopRecording.bind(this),
		);

		// Register event listeners for the AudioRecorder
		this.registerEvent(
			this.audioRecorder.on("recordingStarted", () => {
				console.log("Recording started");
			}),
		);

		this.registerEvent(
			this.audioRecorder.on(
				"recordingComplete",
				async (buffer: ArrayBuffer) => {
					console.log("Recording complete");
					await this.processRecording(buffer);
				},
			),
		);

		this.registerEvent(
			this.audioRecorder.on("error", (error: unknown) => {
				console.error("Recording error:", error);
				new Notice(
					`Error during recording: ${error instanceof Error ? error.message : String(error)}`,
				);
			}),
		);
	}

	private async startRecording() {
		if (this.isRecording) return;

		try {
			await this.audioRecorder.start();
			this.isRecording = true;
			new Notice("Recording started");
		} catch (error) {
			console.error("Error starting recording:", error);
			new Notice("Error starting recording");
			this.isRecording = false;
		}
	}

	private async stopRecording() {
		if (!this.isRecording) return;

		try {
			await this.audioRecorder.stop();
			this.isRecording = false;
			new Notice("Recording stopped");
		} catch (error) {
			console.error("Error stopping recording:", error);
			new Notice("Error stopping recording");
		}
	}

	override onunload() {
		this.audioRecorder.cancel();
		this.audioRecorder.teardown();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private async processRecording(audioBuffer: ArrayBuffer) {
		try {
			const transcription = await this.aiManager.transcribeAudio(audioBuffer);

			const filePath = "dev/transcription.md";
			const file = this.app.vault.getAbstractFileByPath(filePath);
			if (file && file instanceof TFile) {
				await this.app.vault.modify(file, transcription);
			} else {
				await this.app.vault.create(filePath, transcription);
			}

			this.aiManager.run(transcription);
		} catch (error) {
			console.error("Error processing recording:", error);
			new Notice("Error processing recording");
		}
	}
}
