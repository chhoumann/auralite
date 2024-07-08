import { type App, PluginSettingTab, Setting } from "obsidian";
import type OVSPlugin from "./main";

export interface OVSPluginSettings {
	OPENAI_API_KEY: string;
}

export const DEFAULT_SETTINGS: OVSPluginSettings = {
	OPENAI_API_KEY: "",
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
}
