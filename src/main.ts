import Instructor from "@instructor-ai/instructor";
import { Notice, Plugin, TFile } from "obsidian";
import OpenAI from "openai";
import { AudioRecorder } from "./AudioRecorder";
import { ContextBuilder } from "./ContextBuilder";
import {
	DEFAULT_SETTINGS,
	type OVSPluginSettings,
	OVSSettingTab,
} from "./OVSSettingTab";
import {
	CreateNoteAction,
	NoopAction,
	TranscribeAction,
	WriteAction,
} from "./actions/Action";
import { ActionManager } from "./actions/ActionManager";
import { AIManager } from "./ai";
import { registerCommands } from "./commands";
import { WaveformVisualizer } from "./components/WaveformVisualizer";

export default class OVSPlugin extends Plugin {
	settings!: OVSPluginSettings;
	actionManager!: ActionManager;
	contextBuilder!: ContextBuilder;
	private audioRecorder: AudioRecorder = new AudioRecorder();
	private aiManager!: AIManager;
	private _isRecording = false;
	private statusNotice: Notice | null = null;
	private waveformVisualizer: WaveformVisualizer | null = null;

	public get isRecording(): boolean {
		return this._isRecording;
	}

	override async onload() {
		await this.loadSettings();
		this.actionManager = new ActionManager();

		this.actionManager.registerAction(new CreateNoteAction());
		this.actionManager.registerAction(new NoopAction());
		this.actionManager.registerAction(new TranscribeAction());
		this.actionManager.registerAction(new WriteAction());

		const openAIClient = new OpenAI({
			apiKey: this.settings.OPENAI_API_KEY,
			dangerouslyAllowBrowser: true,
		});

		this.contextBuilder = new ContextBuilder(this);

		this.aiManager = new AIManager(
			this,
			this.actionManager.getAllActionIds(),
			openAIClient,
			Instructor({ client: openAIClient, mode: "TOOLS" }),
			this.contextBuilder,
		);

		registerCommands(this);

		this.addSettingTab(new OVSSettingTab(this.app, this));

		// == Push-to-Talk Ribbon Events ==
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

		// == AudioRecorder Events ==
		this.registerEvent(
			this.audioRecorder.on(
				"recordingStarted",
				this.onRecordingStarted.bind(this),
			),
		);

		this.registerEvent(
			this.audioRecorder.on(
				"recordingComplete",
				this.onRecordingComplete.bind(this),
			),
		);

		this.registerEvent(
			this.audioRecorder.on("error", this.onRecordingError.bind(this)),
		);
	}

	async startRecording() {
		if (this.isRecording) return;

		try {
			await this.audioRecorder.start();
			this._isRecording = true;
		} catch (error) {
			console.error("Error starting recording:", error);
			this._isRecording = false;
		}
	}

	async stopRecording() {
		if (!this.isRecording) return;

		try {
			await this.audioRecorder.stop();
			this._isRecording = false;
		} catch (error) {
			console.error("Error stopping recording:", error);
		}
	}

	override onunload() {
		try {
			if (this.audioRecorder) {
				this.audioRecorder.cancel();
				this.audioRecorder.teardown();
			}
		} catch (error) {
			console.error("Error during plugin unload:", error);
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private async processRecording(audioBuffer: ArrayBuffer) {
		try {
			const editorState = await this.contextBuilder.captureEditorState();
			const transcription = await this.aiManager.transcribeAudio(audioBuffer);

			const filePath = "dev/transcription.md";
			const file = this.app.vault.getAbstractFileByPath(filePath);
			if (file && file instanceof TFile) {
				this.app.vault.modify(file, transcription).catch((error) => {
					console.error("Error modifying file:", error);
				});
			} else {
				this.app.vault.create(filePath, transcription).catch((error) => {
					console.error("Error creating file:", error);
				});
			}

			await this.aiManager.run(transcription, editorState);
		} catch (error) {
			console.error("Error processing recording:", error);
		}
	}

	private createWaveform(waveformContainer: HTMLDivElement) {
		const analyser = this.audioRecorder.getAnalyser();
		if (!analyser) return;

		this.waveformVisualizer = new WaveformVisualizer(
			waveformContainer,
			analyser,
		);
		this.waveformVisualizer.start();
	}

	private stopWaveform() {
		if (this.waveformVisualizer) {
			this.waveformVisualizer.stop();
			this.waveformVisualizer = null;
		}
	}

	private onRecordingStarted = () => {
		console.log("Recording started");
		this.statusNotice = new Notice("", 99999999);
		this.createWaveform(this.statusNotice.noticeEl.createEl("div"));
	};

	private async onRecordingComplete(buffer: ArrayBuffer): Promise<void> {
		console.log("Recording complete");
		this.stopWaveform();
		this.statusNotice?.hide();
		this.statusNotice = null;
		await this.processRecording(buffer);
	}

	private async onRecordingError(error: unknown): Promise<void> {
		console.error("Recording error:", error);
		this.statusNotice?.setMessage(
			`Error during recording: ${error instanceof Error ? error.message : String(error)}`,
		);
		setTimeout(() => {
			this.stopWaveform();
			this.statusNotice?.hide();
			this.statusNotice = null;
		}, 5000);
	}

	cancelOngoingOperation() {
		this.aiManager.cancelOngoingOperation();
	}
}
