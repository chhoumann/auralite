import { type Command, Notice } from "obsidian";
import type AuralitePlugin from "./main";

declare const __IS_DEV__: boolean;

export function registerCommands(plugin: AuralitePlugin): void {
	const commands: Array<Command> = [
		{
			id: "reload-auralite",
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
			checkCallback: function (checking: boolean) {
				const isAssistantActive = plugin.isAssistantActive();

				if (plugin.isBusy() && !isAssistantActive) {
					return false;
				}

				// @ts-ignore
				this.name = isAssistantActive
					? "Auralite: Stop Assistant"
					: "Auralite: Start Assistant";

				if (!checking) {
					plugin.toggleAssistant();
				}
				return true;
			},
		},
		{
			id: "cancel-ongoing-operation",
			name: "Cancel Ongoing Operation",
			checkCallback: (checking: boolean) => {
				if (!plugin.isBusy()) return false;
				if (!checking) {
					plugin.cancelOngoingOperation();
				}
				return true;
			},
		},
		{
			id: "auralite-transcribe",
			name: "Transcribe",
			checkCallback: function (checking: boolean) {
				const currentTask = plugin.getCurrentTask();
				const isTranscribeTask =
					plugin.isBusy() &&
					currentTask instanceof plugin.TranscribeTaskConstructor;

				if (plugin.isBusy() && !isTranscribeTask) {
					return false;
				}

				// @ts-ignore
				this.name = isTranscribeTask
					? "Auralite: Stop Transcription"
					: "Auralite: Transcribe";

				if (!checking) {
					plugin.toggleTranscribe();
				}
				return true;
			},
		},
		{
			id: "toggle-chat-view",
			name: "Toggle Chat View",
			callback: () => {
				// Check if the chat view is already open
				const chatLeaves =
					plugin.app.workspace.getLeavesOfType("auralite-chat-view");
				if (chatLeaves.length > 0) {
					// If open, close it
					for (const leaf of chatLeaves) {
						leaf.detach();
					}
				} else {
					// If not open, open it
					plugin.openChatView();
				}
			},
		},
	];

	for (const cmd of commands) {
		plugin.addCommand(cmd);
	}
}
