import { logger } from "@/logging";
import { removeWhitespace } from "@/utils";
import { z } from "zod";
import { Action, type ActionContext } from "./Action";
import {
	flattenQuickAddChoices,
	type QuickAddChoice,
	type QuickAddPlugin,
} from "@/utils/quickadd";

// Utility: Extract variable names from a string (supports {{VALUE}} and {{VALUE:varName}})
function extractVariablesFromString(str: string): Set<string> {
	const regex = /\{\{VALUE(?::([a-zA-Z0-9_\-]+))?\}\}/gi; // case-insensitive
	const variables = new Set<string>();
	let match: RegExpExecArray | null;
	while (true) {
		match = regex.exec(str);
		if (!match) break;
		if (match[1]) {
			variables.add(match[1]);
		} else {
			variables.add("value"); // always use 'value' for bare VALUE
		}
	}
	return variables;
}

// Utility: Extract all variable names from a QuickAdd choice
function extractVariablesFromChoice(choice: QuickAddChoice): string[] {
	const fieldsToCheck = [
		choice.format?.format,
		choice.captureTo,
		choice.insertAfter?.after,
		choice.createFileIfItDoesntExist?.template,
		choice.fileNameFormat?.format,
		choice.templatePath,
	];
	const variables = new Set<string>();
	for (const field of fieldsToCheck) {
		if (typeof field === "string") {
			for (const v of extractVariablesFromString(field)) {
				variables.add(v);
			}
		}
	}
	return Array.from(variables);
}

// Cache for variable schemas (fullPath -> variable names)
const variableSchemaCache = new Map<string, string[]>();

/**
 * Action to execute a QuickAdd choice by name, with variables auto-generated if needed.
 * Uses LLM to select the best matching choice from all Capture/Template choices.
 */
export class QuickAddAction extends Action<typeof QuickAddAction.inputSchema> {
	readonly description =
		"Execute a QuickAdd action (Capture/Template) by name, with variables (auto-generated if needed).";

	static inputSchema = z.object({
		userRequest: z
			.string()
			.describe("The user's request or intent for the QuickAdd action."),
	});

	static systemPrompt = removeWhitespace(`
    You are an expert at mapping user intent to QuickAdd actions in Obsidian.
    Given a user's request and a list of available QuickAdd actions, select the best matching action and generate the correct variable values. Only output a JSON object with { choiceName, variables }.
  `);

	constructor() {
		super("quickadd", QuickAddAction.inputSchema, QuickAddAction.systemPrompt);
	}

	protected async performAction(
		input: z.infer<typeof QuickAddAction.inputSchema>,
		context: ActionContext,
	): Promise<void> {
		const { app, results } = context;
		const quickAdd = app.plugins.plugins.quickadd as QuickAddPlugin | undefined;
		if (!quickAdd || !quickAdd.api || !quickAdd.settings) {
			logger.error("QuickAdd plugin is not installed or enabled.");
			results.set(this.id, {
				status: "error",
				error: "QuickAdd plugin is not installed or enabled.",
			});
			throw new Error("QuickAdd plugin is not installed or enabled.");
		}

		// 1. Flatten all Capture/Template choices
		const allChoices = flattenQuickAddChoices(quickAdd.settings.choices);
		if (allChoices.length === 0) {
			logger.error("No Capture or Template QuickAdd choices found.");
			results.set(this.id, {
				status: "error",
				error: "No Capture or Template QuickAdd choices found.",
			});
			throw new Error("No Capture or Template QuickAdd choices found.");
		}

		// 2. Use LLM to select the best matching choice (structured enum completion)
		const allFullPaths = allChoices.map((c) => c.fullPath);
		if (allFullPaths.length === 0) {
			logger.error("No valid QuickAdd choices to select from.");
			results.set(this.id, {
				status: "error",
				error: "No valid QuickAdd choices to select from.",
			});
			throw new Error("No valid QuickAdd choices to select from.");
		}
		// Zod enum for all full paths
		const selectionSchema = z.object({
			choiceName: z.enum(allFullPaths as [string, ...string[]]),
		});
		const selectionPrompt = `Select the best matching QuickAdd action from the following list (use the exact full path). Only output a JSON object with { \"choiceName\": ... }:\n${allFullPaths.join("\n")}`;
		const selection = await context.ai.createInstructorChatCompletion(
			selectionSchema,
			[
				{ role: "system", content: selectionPrompt },
				{ role: "user", content: input.userRequest },
			],
		);
		// Type guard: ensure selection has choiceName
		const selectedChoiceName = (selection as { choiceName?: string })
			.choiceName;
		if (!selectedChoiceName) {
			logger.error("LLM did not return a valid choiceName.");
			results.set(this.id, {
				status: "error",
				error: "LLM did not return a valid choiceName.",
			});
			throw new Error("LLM did not return a valid choiceName.");
		}
		const selected = allChoices.find((c) => c.fullPath === selectedChoiceName);
		if (!selected) {
			logger.error(
				`Selected QuickAdd choice '${selectedChoiceName}' not found.`,
			);
			results.set(this.id, {
				status: "error",
				error: `Selected QuickAdd choice '${selectedChoiceName}' not found.`,
			});
			throw new Error(
				`Selected QuickAdd choice '${selectedChoiceName}' not found.`,
			);
		}

		const { choice, fullPath } = selected;

		// 3. Get or extract variable schema
		let variableNames = variableSchemaCache.get(fullPath);
		if (!variableNames) {
			variableNames = extractVariablesFromChoice(choice);
			variableSchemaCache.set(fullPath, variableNames);
		}

		let variables: Record<string, unknown> = {};
		if (variableNames.length > 0) {
			// Build a stricter Zod schema if variable names are known
			let variableSchema: z.AnyZodObject;
			if (variableNames.length > 0) {
				const shape: Record<string, z.ZodString> = {};
				for (const name of variableNames) {
					shape[name] = z.string();
				}
				variableSchema = z.object(shape);
			} else {
				variableSchema = z.object({});
			}

			// Build a rich, context-aware prompt for variable generation
			const variableDescriptions = variableNames
				.map((name) => {
					if (name.toLowerCase() === "value") {
						return `- ${name}: The main input or content for this action.`;
					}
					// Optionally, infer more from context here
					return `- ${name}: A value required by this action.`;
				})
				.join("\n");

			const actionType = choice.type;
			const actionName = choice.name;
			const formatString =
				choice.format?.format ||
				choice.fileNameFormat?.format ||
				choice.captureTo ||
				choice.templatePath ||
				"";
			const formatLine = formatString
				? `Format/template: \n${formatString}\n`
				: "";

			const variablePrompt = `You are filling variables for the QuickAdd action '${actionName}' (type: ${actionType}).\n${formatLine}Variables:\n${variableDescriptions}\nGiven the user's request, output a JSON object with the following keys: ${variableNames.join(", ")}. Only output the JSON object, nothing else.`;

			const variableResult = await context.ai.createInstructorChatCompletion(
				variableSchema,
				[
					{ role: "system", content: variablePrompt },
					{ role: "user", content: input.userRequest },
				],
			);
			variables = variableResult;
		}

		try {
			await quickAdd.api.executeChoice(choice.name, variables);
			results.set(this.id, {
				status: "success",
				choiceName: choice.name,
				fullPath,
				variables,
			});
		} catch (err) {
			logger.error("Failed to execute QuickAdd choice", {
				err,
				choiceName: choice.name,
				fullPath,
				variables,
			});
			results.set(this.id, {
				status: "error",
				error: err instanceof Error ? err.message : String(err),
			});
			throw new Error(
				`Failed to execute QuickAdd choice '${choice.name}': ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}
}
