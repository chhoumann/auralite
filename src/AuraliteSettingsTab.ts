import { type App, PluginSettingTab, Setting } from "obsidian";
import type AuralitePlugin from "./main";

const models = ["gpt-4o"] as const;

type OpenAIModel = (typeof models)[number];

export interface AuralitePluginSettings {
	OPENAI_API_KEY: string;
	OPENAI_MODEL: OpenAIModel;
	SILENCE_DETECTION_ENABLED: boolean;
	SILENCE_DURATION: number;
	DEFAULT_NOTE_TEMPLATE_PATH: string;
}

export const DEFAULT_SETTINGS: AuralitePluginSettings = {
	OPENAI_API_KEY: "",
	OPENAI_MODEL: "gpt-4o",
	SILENCE_DETECTION_ENABLED: false,
	SILENCE_DURATION: 2000,
	DEFAULT_NOTE_TEMPLATE_PATH: "",
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

		this.addOpenAIApiKeySetting(containerEl);
		this.addOpenAIModelSetting(containerEl);
		this.addSilenceDetectionSettings(containerEl);
		this.addDefaultNoteTemplateSetting(containerEl);
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
}
