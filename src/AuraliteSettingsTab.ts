import { type App, PluginSettingTab, Setting } from "obsidian";
import type AuralitePlugin from "./main";

const models = [
	"gpt-4.1",
	"gpt-4.1-mini",
	"gpt-4.1-nano",
	"gpt-4o",
	"gpt-4o-mini",
	"o4-mini",
	"o3",
	"o3-mini",
	"o1",
	"o1-mini",
] as const;
const transcriptionModels = [
	"whisper-1",
	"gpt-4o-transcribe",
	"gpt-4o-mini-transcribe",
] as const;

type OpenAIModel = (typeof models)[number];
type TranscriptionModel = (typeof transcriptionModels)[number];

export interface AuralitePluginSettings {
	OPENAI_API_KEY: string;
	OPENAI_MODEL: OpenAIModel;
	SILENCE_DETECTION_ENABLED: boolean;
	SILENCE_DURATION: number;
	DEFAULT_NOTE_TEMPLATE_PATH: string;
	USE_EDIT_MODE_BY_DEFAULT: boolean;
	TELEMETRY_ENABLED: boolean;
	TRANSCRIPTION_MODEL: TranscriptionModel;
	/**
	 * Per-action model selection. Keyed by action id (e.g., "edit", "write").
	 * If not set for an action, falls back to OPENAI_MODEL.
	 */
	actionModels?: Record<string, OpenAIModel>;
}

export const DEFAULT_SETTINGS: AuralitePluginSettings = {
	OPENAI_API_KEY: "",
	OPENAI_MODEL: "gpt-4.1",
	SILENCE_DETECTION_ENABLED: false,
	SILENCE_DURATION: 2000,
	DEFAULT_NOTE_TEMPLATE_PATH: "",
	USE_EDIT_MODE_BY_DEFAULT: false,
	TELEMETRY_ENABLED: true,
	TRANSCRIPTION_MODEL: "whisper-1",
	actionModels: {},
};

export class AuraliteSettingsTab extends PluginSettingTab {
	plugin: AuralitePlugin;

	constructor(app: App, plugin: AuralitePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		// API Key Section
		const apiSection = containerEl.createDiv({
			cls: "auralite-settings-section",
		});
		this.addOpenAIApiKeySetting(apiSection);

		// Model Section
		const modelSection = containerEl.createDiv({
			cls: "auralite-settings-section",
		});
		this.addOpenAIModelSetting(modelSection);
		this.addTranscriptionModelSetting(modelSection);
		this.addPerActionModelSettings(modelSection);

		containerEl.createEl("hr", { cls: "auralite-settings-divider" });

		// Silence Detection Section
		const silenceSection = containerEl.createDiv({
			cls: "auralite-settings-section",
		});
		this.addSilenceDetectionSettings(silenceSection);

		// Template Section
		const templateSection = containerEl.createDiv({
			cls: "auralite-settings-section",
		});
		this.addDefaultNoteTemplateSetting(templateSection);

		// Edit Mode Section
		const editSection = containerEl.createDiv({
			cls: "auralite-settings-section",
		});
		this.addEditModeSettings(editSection);

		containerEl.createEl("hr", { cls: "auralite-settings-divider" });

		// Telemetry Section
		const telemetrySection = containerEl.createDiv({
			cls: "auralite-settings-section",
		});
		this.addTelemetrySettings(telemetrySection);
	}

	addOpenAIApiKeySetting(containerEl: HTMLElement) {
		new Setting(containerEl)
			.setName("OpenAI API Key")
			.setDesc("API key for OpenAI")
			.addText((text) => {
				text
					.setPlaceholder("sk-...")
					.setValue(this.plugin.settings.OPENAI_API_KEY)
					.onChange(async (value) => {
						this.plugin.settings.OPENAI_API_KEY = value;
						await this.plugin.saveSettings();
					});

				text.inputEl.type = "password";
			});
	}

	addOpenAIModelSetting(containerEl: HTMLElement) {
		new Setting(containerEl)
			.setName("OpenAI Model")
			.setDesc("Select the OpenAI model to use")
			.addDropdown((dropdown) => {
				for (const model of models) {
					dropdown.addOption(model, model);
				}
				dropdown
					.setValue(this.plugin.settings.OPENAI_MODEL)
					.onChange(async (value) => {
						this.plugin.settings.OPENAI_MODEL = value as OpenAIModel;
						await this.plugin.saveSettings();
					});
			});
	}

	addTranscriptionModelSetting(containerEl: HTMLElement) {
		new Setting(containerEl)
			.setName("Transcription Model")
			.setDesc("Select the model to use for audio transcription.")
			.addDropdown((dropdown) => {
				for (const model of transcriptionModels) {
					dropdown.addOption(model, model);
				}
				dropdown
					.setValue(this.plugin.settings.TRANSCRIPTION_MODEL)
					.onChange(async (value) => {
						this.plugin.settings.TRANSCRIPTION_MODEL =
							value as TranscriptionModel;
						await this.plugin.saveSettings();
					});
			});
	}

	addPerActionModelSettings(containerEl: HTMLElement) {
		const section = containerEl.createEl("details");
		section.createEl("summary", {
			text: "Advanced: Per-Action Model Selection",
		});
		section.createEl("div", {
			text: "Override the LLM model for specific actions. If not set, the global model is used.",
			cls: "setting-item-description",
		});

		const actions =
			this.plugin.actionManager?.getAllActions?.().filter((a) => a.usesLLM) ??
			[];
		if (!actions.length) {
			section.createEl("div", { text: "No actions registered yet." });
			return;
		}

		for (const action of actions) {
			const actionId = action.id;
			const label = action.description || actionId;
			new Setting(section)
				.setName(label)
				.setDesc(`Model for action: ${actionId}`)
				.addDropdown((dropdown) => {
					dropdown.addOption(
						"",
						`Use global model (${this.plugin.settings.OPENAI_MODEL})`,
					);
					for (const model of models) {
						dropdown.addOption(model, model);
					}
					const current = this.plugin.settings.actionModels?.[actionId] || "";
					dropdown.setValue(current);
					dropdown.onChange(async (value) => {
						if (!this.plugin.settings.actionModels)
							this.plugin.settings.actionModels = {};
						if (value === "") {
							delete this.plugin.settings.actionModels[actionId];
						} else {
							this.plugin.settings.actionModels[actionId] =
								value as OpenAIModel;
						}
						await this.plugin.saveSettings();
					});
				});
		}
	}

	addSilenceDetectionSettings(containerEl: HTMLElement) {
		const silenceDetectionSetting = new Setting(containerEl)
			.setName("Silence Detection")
			.setDesc("Automatically stop recording after a period of silence")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.SILENCE_DETECTION_ENABLED)
					.onChange(async (value) => {
						this.plugin.toggleSilenceDetection(value);
						silenceDetectionSetting.components[1].setDisabled(!value);
						await this.plugin.saveSettings();
					}),
			)
			.addSlider((slider) =>
				slider
					.setLimits(0.5, 10, 0.1)
					.setValue(this.plugin.settings.SILENCE_DURATION / 1000)
					.setDynamicTooltip()
					.setDisabled(!this.plugin.settings.SILENCE_DETECTION_ENABLED)
					.onChange(async (value) => {
						const durationMs = Math.round(value * 1000);
						this.plugin.settings.SILENCE_DURATION = durationMs;
						this.plugin.updateSilenceDetectionOptions({
							silenceDuration: durationMs,
						});
						await this.plugin.saveSettings();
					}),
			);

		silenceDetectionSetting.components[1].setDisabled(
			!this.plugin.settings.SILENCE_DETECTION_ENABLED,
		);

		silenceDetectionSetting.controlEl.createEl("span", {
			text: "seconds",
			cls: "setting-item-description",
		});
	}

	addDefaultNoteTemplateSetting(containerEl: HTMLElement) {
		new Setting(containerEl)
			.setName("Default Note Template")
			.setDesc(
				"Path to the note to use as a template (leave empty for no template)",
			)
			.addText((text) =>
				text
					.setPlaceholder("path/to/template.md")
					.setValue(this.plugin.settings.DEFAULT_NOTE_TEMPLATE_PATH)
					.onChange(async (value) => {
						this.plugin.settings.DEFAULT_NOTE_TEMPLATE_PATH = value;
						await this.plugin.saveSettings();
					}),
			);
	}

	addEditModeSettings(containerEl: HTMLElement) {
		new Setting(containerEl)
			.setName("Use Edit Mode by Default")
			.setDesc(
				"Use OpenAI's edit mode for faster edit operations by default. The AI will decide when to override this.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.USE_EDIT_MODE_BY_DEFAULT)
					.onChange(async (value) => {
						this.plugin.settings.USE_EDIT_MODE_BY_DEFAULT = value;
						await this.plugin.saveSettings();
					}),
			);
	}

	addTelemetrySettings(containerEl: HTMLElement) {
		const telemetrySection = containerEl.createEl("div");
		telemetrySection.createEl("h3", { text: "Telemetry" });

		new Setting(telemetrySection)
			.setName("Enable Token Usage Tracking")
			.setDesc(
				"Track token usage for debugging and performance analysis (data stays on your device)",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.TELEMETRY_ENABLED)
					.onChange(async (value) => {
						this.plugin.settings.TELEMETRY_ENABLED = value;
						this.plugin.toggleTelemetry(value);
						await this.plugin.saveSettings();
					}),
			);

		// Add debug mode toggle (hidden behind advanced settings)
		const advancedSection = telemetrySection.createEl("details");
		advancedSection.createEl("summary", {
			text: "Advanced Settings",
			cls: "telemetry-advanced-toggle",
		});

		new Setting(advancedSection)
			.setName("Debug Mode")
			.setDesc(
				"Enable detailed request/response logging for debugging (developer use only)",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(false) // Always default to false
					.onChange((value) => {
						// Don't persist this setting, it's for debugging only
						this.plugin.toggleTelemetryDebugMode(value);
					}),
			);

		// Add button to view telemetry data
		new Setting(telemetrySection)
			.setName("Token Usage Stats")
			.setDesc("View token usage statistics and analytics")
			.addButton((button) => {
				button.setButtonText("View Stats").onClick(() => {
					this.plugin.showTelemetryModal();
				});
			})
			.addButton((button) => {
				button.setButtonText("Clear Data").onClick(() => {
					this.plugin.clearTelemetryData();
				});
			});
	}
}
