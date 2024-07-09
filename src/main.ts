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
import { ActionManager } from "./actions/ActionManager";
import { CreateNoteAction } from "./actions/CreateNoteAction";
import { NoopAction } from "./actions/NoopAction";
import { TranscribeAction } from "./actions/TranscribeAction";
import { WriteAction } from "./actions/WriteAction";
import { AIManager } from "./ai";
import { registerCommands } from "./commands";
import { FloatingBar } from "./components/FloatingBar";
import { WaveformVisualizer } from "./components/WaveformVisualizer";

declare const __IS_DEV__: boolean;

export default class OVSPlugin extends Plugin {
	settings!: OVSPluginSettings;
	actionManager!: ActionManager;
	contextBuilder!: ContextBuilder;
	private audioRecorder: AudioRecorder = new AudioRecorder();
	private aiManager!: AIManager;
	private _isRecording = false;
	private waveformVisualizer: WaveformVisualizer | null = null;
	private floatingBar: FloatingBar | null = null;

	public get isRecording(): boolean {
		return this._isRecording;
	}

	override async onload() {
		await this.loadSettings();
		this.initializeComponents();
		this.setupEventListeners();
		registerCommands(this);
		this.addSettingTab(new OVSSettingTab(this.app, this));
	}

	private initializeComponents() {
		this.actionManager = new ActionManager();
		this.registerActions();

		const openAIClient = this.createOpenAIClient();
		this.contextBuilder = new ContextBuilder(this);
		this.aiManager = this.createAIManager(openAIClient);

		this.floatingBar = new FloatingBar(this.app.workspace.containerEl);
	}

	private registerActions() {
		this.actionManager.registerAction(new CreateNoteAction());
		this.actionManager.registerAction(new NoopAction());
		this.actionManager.registerAction(new TranscribeAction());
		this.actionManager.registerAction(new WriteAction());
	}

	private createOpenAIClient() {
		return new OpenAI({
			apiKey: this.settings.OPENAI_API_KEY,
			dangerouslyAllowBrowser: true,
		});
	}

	private createAIManager(openAIClient: OpenAI) {
		return new AIManager(
			this,
			this.actionManager.getAllActionIds(),
			openAIClient,
			Instructor({ client: openAIClient, mode: "TOOLS" }),
			this.contextBuilder,
		);
	}

	private setupEventListeners() {
		this.setupPushToTalkEvents();
		this.setupAudioRecorderEvents();
	}

	private setupPushToTalkEvents() {
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
	}

	private setupAudioRecorderEvents() {
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

			if (this.floatingBar) {
				this.floatingBar.remove();
				this.floatingBar = null;
			}

			if (this.waveformVisualizer) {
				this.waveformVisualizer.stop();
				this.waveformVisualizer = null;
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

			if (__IS_DEV__) {
				await this.saveTranscriptionForDev(transcription);
			}

			await this.aiManager.run(transcription, editorState);
		} catch (error) {
			this.handleProcessingError(error);
		}
	}

	private async saveTranscriptionForDev(transcription: string) {
		const filePath = "dev/transcription.md";
		try {
			await this.saveTranscription(filePath, transcription);
		} catch (error) {
			console.error("Error saving transcription:", error);
		}
	}

	private handleProcessingError(error: unknown) {
		console.error("Error processing recording:", error);
		new Notice("Error processing recording. Check console for details.");
	}

	private async saveTranscription(filePath: string, transcription: string) {
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (file instanceof TFile) {
			await this.app.vault.modify(file, transcription);
		} else {
			await this.app.vault.create(filePath, transcription);
		}
	}

	private createWaveform(analyser: AnalyserNode) {
		this.stopWaveform();
		if (this.floatingBar) {
			this.waveformVisualizer = new WaveformVisualizer(
				this.floatingBar.waveformContainer,
				analyser,
			);
			this.waveformVisualizer.start();
		}
	}

	private stopWaveform() {
		if (this.waveformVisualizer) {
			this.waveformVisualizer.stop();
			this.waveformVisualizer = null;
		}
	}

	private onRecordingStarted = () => {
		console.log("Recording started");
		const analyser = this.audioRecorder.getAnalyser();

		if (this.floatingBar && analyser) {
			this.floatingBar.show();
			this.createWaveform(analyser);
		}
	};

	private async onRecordingComplete(buffer: ArrayBuffer): Promise<void> {
		console.log("Recording complete");
		this.stopWaveform();
		this.floatingBar?.setStatus("Processing recording...");
		await this.processRecording(buffer);
		this.floatingBar?.hide();
	}

	private async onRecordingError(error: unknown): Promise<void> {
		console.error("Recording error:", error);
		this.floatingBar?.setStatus(
			`Error during recording: ${error instanceof Error ? error.message : String(error)}`,
		);
		setTimeout(() => {
			this.stopWaveform();
			this.floatingBar?.hide();
		}, 5000);
	}

	cancelOngoingOperation() {
		this.aiManager.cancelOngoingOperation();
	}
}
