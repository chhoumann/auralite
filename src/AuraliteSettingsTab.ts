import { type App, PluginSettingTab, Setting } from "obsidian";
import type AuralitePlugin from "./main";

const models = ["gpt-4o"] as const;

type OpenAIModel = (typeof models)[number];

export interface AuralitePluginSettings {
	OPENAI_API_KEY: string;
	OPENAI_MODEL: OpenAIModel;
}

export const DEFAULT_SETTINGS: AuralitePluginSettings = {
	OPENAI_API_KEY: "",
	OPENAI_MODEL: "gpt-4o",
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
}
