import { Plugin } from "obsidian";
import { registerCommands } from "./commands";

export default class OVSPlugin extends Plugin {
	override async onload() {
		registerCommands(this);

		this.addRibbonIcon("mic", "Start chat", () => {
			console.log("Start chat");
		});
	}

	override onunload() {}
}
