import Instructor from "@instructor-ai/instructor";
import { Plugin, TFile } from "obsidian";
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
import { logger } from "./logging";
import { AssistantTask } from "./tasks/AssistantTask";
import { TranscribeTask } from "./tasks/TranscribeTask";

declare const __IS_DEV__: boolean;

export default class OVSPlugin extends Plugin {
	settings!: OVSPluginSettings;
	actionManager!: ActionManager;
	contextBuilder!: ContextBuilder;
	private audioRecorder: AudioRecorder = new AudioRecorder();
	private aiManager!: AIManager;

	private currentTask?: TranscribeTask | AssistantTask;

	override async onload() {
		await this.loadSettings();
		this.initializeComponents();
		this.setupPushToTalkEvents();
		registerCommands(this);
		this.addSettingTab(new OVSSettingTab(this.app, this));
	}

	private initializeComponents() {
		this.actionManager = new ActionManager();
		this.registerActions();

		const openAIClient = this.createOpenAIClient();
		this.contextBuilder = new ContextBuilder(this);
		this.aiManager = this.createAIManager(openAIClient);
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

	private setupPushToTalkEvents() {
		const ribbonIcon = this.addRibbonIcon("mic", "Push to talk", () => {});
		this.registerDomEvent(ribbonIcon, "mousedown", () => {
			this.setupCurrentTask(
				new AssistantTask(
					this,
					this.audioRecorder,
					this.contextBuilder,
					this.aiManager,
				),
			);
		});
		this.registerDomEvent(ribbonIcon, "mouseup", () => {
			if (this.currentTask) {
				this.currentTask.stop();
			}
		});
		this.registerDomEvent(ribbonIcon, "mouseleave", () => {
			if (this.currentTask) {
				this.currentTask.stop();
			}
		});
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

	private setupCurrentTask(task: TranscribeTask | AssistantTask) {
		this.currentTask?.cancel();
		this.currentTask = task;
		this.currentTask.on("taskFinished", () => {
			this.currentTask = undefined;
		});
		this.currentTask.start();

		return this.currentTask;
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
}
