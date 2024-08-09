import Instructor from "@instructor-ai/instructor";
import { Plugin, TFile } from "obsidian";
import OpenAI from "openai";
import { AudioRecorder } from "./AudioRecorder";
import { ContextBuilder } from "./ContextBuilder";
import {
	DEFAULT_SETTINGS,
	type AuralitePluginSettings,
	AuraliteSettingsTab,
} from "./AuraliteSettingsTab";
import {
	SilenceDetection,
	type SilenceDetectionOptions,
} from "./SilenceDetection";
import { ActionManager } from "./actions/ActionManager";
import { CreateNoteAction } from "./actions/CreateNoteAction";
import { EditAction } from "./actions/EditAction";
import { NoopAction } from "./actions/NoopAction";
import { TranscribeAction } from "./actions/TranscribeAction";
import { WriteAction } from "./actions/WriteAction";
import { AIManager } from "./ai";
import { registerCommands } from "./commands";
import { logger } from "./logging";
import { AssistantTask } from "./tasks/AssistantTask";
import { TranscribeTask } from "./tasks/TranscribeTask";

declare const __IS_DEV__: boolean;

export default class AuralitePlugin extends Plugin {
	settings!: AuralitePluginSettings;
	actionManager!: ActionManager;
	contextBuilder!: ContextBuilder;
	private audioRecorder: AudioRecorder = new AudioRecorder();
	private aiManager!: AIManager;
	private silenceDetection?: SilenceDetection;
	private currentTask?: TranscribeTask | AssistantTask;

	override async onload() {
		await this.loadSettings();
		this.initializeComponents();
		this.setupPushToTalkEvents();
		registerCommands(this);
		this.addSettingTab(new AuraliteSettingsTab(this.app, this));
	}

	private initializeComponents() {
		this.initializeActionManager();
		this.initializeAIManager();
		this.initializeSilenceDetection();
	}

	private initializeActionManager() {
		this.actionManager = new ActionManager();
		this.actionManager.registerAction(new CreateNoteAction());
		this.actionManager.registerAction(new NoopAction());
		this.actionManager.registerAction(new TranscribeAction());
		this.actionManager.registerAction(new WriteAction());
		this.actionManager.registerAction(new EditAction());
	}

	private initializeAIManager() {
		const openAIClient = this.createOpenAIClient();
		this.contextBuilder = new ContextBuilder(this);
		this.aiManager = new AIManager(
			this,
			this.actionManager.getAllActionIds(),
			openAIClient,
			Instructor({ client: openAIClient, mode: "TOOLS" }),
			this.contextBuilder,
		);
	}

	private initializeSilenceDetection() {
		if (this.settings.SILENCE_DETECTION_ENABLED) {
			this.silenceDetection = new SilenceDetection({
				silenceThreshold: 0.01,
				silenceDuration: this.settings.SILENCE_DURATION,
			});
			this.registerEvent(
				this.silenceDetection.on("silenceDetected", this.handleSilenceDetected),
			);
		}
	}

	private handleSilenceDetected = () => {
		if (this.currentTask && this.audioRecorder.isRecording()) {
			logger.debug("Silence detected, stopping recording");
			this.currentTask.stop();
		}
	};

	private createOpenAIClient() {
		return new OpenAI({
			apiKey: this.settings.OPENAI_API_KEY,
			dangerouslyAllowBrowser: true,
		});
	}

	private setupPushToTalkEvents() {
		const ribbonIcon = this.addRibbonIcon("mic", "Push to talk", () => {});
		this.registerDomEvent(ribbonIcon, "mousedown", this.handlePushToTalkStart);
		this.registerDomEvent(ribbonIcon, "mouseup", this.handlePushToTalkEnd);
		this.registerDomEvent(ribbonIcon, "mouseleave", this.handlePushToTalkEnd);
	}

	private handlePushToTalkStart = () => {
		this.setupCurrentTask(
			new AssistantTask(
				this,
				this.audioRecorder,
				this.contextBuilder,
				this.aiManager,
			),
		);
	};

	private handlePushToTalkEnd = () => {
		this.currentTask?.stop();
	};

	private async setupCurrentTask(task: TranscribeTask | AssistantTask) {
		this.currentTask?.cancel();
		this.currentTask = task;
		this.registerEvent(
			this.currentTask.on("taskFinished", () => {
				this.currentTask = undefined;
				this.silenceDetection?.stop();
			}),
		);
		await this.currentTask.start();

		const analyser = this.audioRecorder.getAnalyser();
		if (analyser && this.silenceDetection) {
			this.silenceDetection.setAnalyser(analyser);
			this.silenceDetection.start();
		}

		return this.currentTask;
	}

	override onunload() {
		try {
			this.cancelOngoingOperation();

			if (this.audioRecorder) {
				this.audioRecorder.cancel();
				this.audioRecorder.teardown();
			}
		} catch (error) {
			logger.error("Error during plugin unload", { error });
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async saveTranscriptionForDev(transcription: string) {
		const filePath = "dev/transcription.md";
		try {
			await this.saveTranscription(filePath, transcription);
		} catch (error) {
			logger.error("Error saving transcription", { error });
		}
	}

	private async saveTranscription(filePath: string, transcription: string) {
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (file instanceof TFile) {
			await this.app.vault.modify(file, transcription);
		} else {
			await this.app.vault.create(filePath, transcription);
		}
	}

	cancelOngoingOperation() {
		this.currentTask?.cancel();
		this.currentTask = undefined;
	}

	public toggleTranscribe() {
		if (this.currentTask && this.currentTask instanceof TranscribeTask) {
			this.currentTask.stop();
			return;
		}

		this.setupCurrentTask(
			new TranscribeTask(
				this,
				this.audioRecorder,
				this.contextBuilder,
				this.aiManager,
			),
		);
	}

	public toggleAssistant(): void {
		if (this.currentTask && this.currentTask instanceof AssistantTask) {
			this.currentTask.stop();
			return;
		}

		this.setupCurrentTask(
			new AssistantTask(
				this,
				this.audioRecorder,
				this.contextBuilder,
				this.aiManager,
			),
		);
	}

	public toggleSilenceDetection(enabled: boolean) {
		this.settings.SILENCE_DETECTION_ENABLED = enabled;
		if (enabled && !this.silenceDetection) {
			this.initializeSilenceDetection();
		} else if (!enabled && this.silenceDetection) {
			this.silenceDetection.stop();
			this.silenceDetection = undefined;
		}
	}

	public updateSilenceDetectionOptions(
		options: Partial<SilenceDetectionOptions>,
	) {
		if (this.silenceDetection) {
			this.silenceDetection.updateOptions(options);
		}
	}
}
