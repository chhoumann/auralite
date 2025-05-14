import "obsidian";

declare module "obsidian" {
	interface App {
		plugins: {
            plugins: any;
			disablePlugin(id: string): Promise<void>;
			enablePlugin(id: string): Promise<void>;
		};
	}
}
