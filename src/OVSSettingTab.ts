import { type App, PluginSettingTab, Setting } from "obsidian";
import type OVSPlugin from "./main";

const models = ["gpt-4o"] as const;

type OpenAIModel = (typeof models)[number];

export interface OVSPluginSettings {
	OPENAI_API_KEY: string;
	OPENAI_MODEL: OpenAIModel;
	SILENCE_DETECTION_ENABLED: boolean;
	SILENCE_DURATION: number;
}

export const DEFAULT_SETTINGS: OVSPluginSettings = {
	OPENAI_API_KEY: "",
	OPENAI_MODEL: "gpt-4o",
	SILENCE_DETECTION_ENABLED: false,
	SILENCE_DURATION: 2000,
};

export class OVSSettingTab extends PluginSettingTab {
	plugin: OVSPlugin;

	constructor(app: App, plugin: OVSPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		this.addOpenAIApiKeySetting(containerEl);
		this.addOpenAIModelSetting(containerEl);
		this.addSilenceDetectionSettings(containerEl);
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
}
