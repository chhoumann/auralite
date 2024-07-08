import "obsidian";

declare module "obsidian" {
	interface App {
		plugins: {
			disablePlugin(id: string): Promise<void>;
			enablePlugin(id: string): Promise<void>;
		};
	}
}
