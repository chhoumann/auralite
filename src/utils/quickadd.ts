// Utility to flatten QuickAdd choices (Capture/Template), including nested Multi
export type QuickAddChoiceType = "Capture" | "Template" | "Macro" | "Multi";

export interface QuickAddChoice {
	id: string;
	name: string;
	type: QuickAddChoiceType;
	choices?: QuickAddChoice[];
	format?: { format?: string };
	captureTo?: string;
	insertAfter?: { after?: string };
	createFileIfItDoesntExist?: { template?: string };
	fileNameFormat?: { format?: string };
	templatePath?: string;
}

export interface QuickAddPlugin {
	settings: {
		choices: QuickAddChoice[];
	};
	api: {
		executeChoice: (
			choiceName: string,
			variables?: Record<string, unknown>,
		) => Promise<void>;
	};
}

export function flattenQuickAddChoices(
	choices: QuickAddChoice[],
	parentPath: string[] = [],
): { choice: QuickAddChoice; fullPath: string }[] {
	const result: { choice: QuickAddChoice; fullPath: string }[] = [];
	for (const choice of choices) {
		const currentPath = [...parentPath, choice.name];
		if (choice.type === "Capture" || choice.type === "Template") {
			result.push({ choice, fullPath: currentPath.join(" > ") });
		} else if (choice.type === "Multi" && Array.isArray(choice.choices)) {
			result.push(...flattenQuickAddChoices(choice.choices, currentPath));
		}
	}
	return result;
}
