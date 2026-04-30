import "obsidian";
import type { QuickAddPlugin } from "../utils/quickadd";

declare module "obsidian" {
	interface App {
		plugins: {
			plugins: {
				quickadd?: QuickAddPlugin;
				[pluginId: string]: unknown;
			};
			disablePlugin(id: string): Promise<void>;
			enablePlugin(id: string): Promise<void>;
		};
	}
}
