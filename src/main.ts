import { Notice, Plugin } from "obsidian";

declare const __IS_DEV__: boolean;

export default class OVSPlugin extends Plugin {
	override async onload() {
		this.addCommand({
			id: "reload-ovs",
			name: "Reload OVS",
			checkCallback: (checking: boolean) => {
				if (checking) {
					return __IS_DEV__;
				}
				if (!checking && __IS_DEV__) {
					(async () => {
						await this.app.plugins.disablePlugin(this.manifest.id);
						await this.app.plugins.enablePlugin(this.manifest.id);
						new Notice("Plugin reloaded");
					})();
				}
			},
		});
	}

	override onunload() {}
}
