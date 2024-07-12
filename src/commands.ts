import { type Command, Notice } from "obsidian";
import type OVSPlugin from "./main";

declare const __IS_DEV__: boolean;

export function registerCommands(plugin: OVSPlugin): void {
	const commands: Array<Command> = [
		{
			id: "reload-ovs",
			name: `Reload ${plugin.manifest.name}${__IS_DEV__ ? " (dev)" : ""}`,
			checkCallback: (checking: boolean) => {
				if (checking) {
					return __IS_DEV__;
				}
				if (!checking && __IS_DEV__) {
					(async () => {
						await plugin.app.plugins.disablePlugin(plugin.manifest.id);
						await plugin.app.plugins.enablePlugin(plugin.manifest.id);
						new Notice("Plugin reloaded");
					})();
				}
			},
		},
		{
			id: "toggle-ai-assistant-listening",
			name: "Toggle AI Assistant Listening",
			callback: () => {
				plugin.toggleAssistant();
			},
		},
		{
			id: "cancel-ongoing-operation",
			name: "Cancel Ongoing Operation",
			callback: () => {
				plugin.cancelOngoingOperation();
			},
		},
		{
			id: "ovs-transcribe",
			name: "Transcribe",
			callback: () => {
				plugin.toggleTranscribe();
			},
		},
	];

	for (const cmd of commands) {
		plugin.addCommand(cmd);
	}
}
