import { Plugin } from "obsidian";

export default class OVSPlugin extends Plugin {
	override async onload() {
		console.log("OVS plugin loaded!!");
		// Add your plugin functionality here
	}

	override onunload() {
		console.log("OVS plugin unloaded");
	}
}
