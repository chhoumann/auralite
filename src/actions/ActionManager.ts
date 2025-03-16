import type { z } from "zod";
import type { Action, ActionContext } from "./Action";

export class ActionManager {
	private actions: Map<string, Action<z.AnyZodObject>> = new Map();

	registerAction<T extends z.AnyZodObject>(action: Action<T>): void {
		this.actions.set(action.id, action);
	}

	getAction(id: string): Action<z.AnyZodObject> | undefined {
		return this.actions.get(id);
	}

	getAllActionIds(): string[] {
		return Array.from(this.actions.keys());
	}

	getAllActions(): Action<z.AnyZodObject>[] {
		return Array.from(this.actions.values());
	}

	async executeAction(id: string, context: ActionContext): Promise<void> {
		const action = this.getAction(id);
		if (!action) {
			throw new Error(`Action with id '${id}' not found`);
		}

		// Import telemetry here to avoid circular dependencies
		const { telemetry } = require("../telemetry");

		// Start recording telemetry for this action execution
		const operationName = `action_${id}`;
		const requestId = telemetry.startRecording(
			context.plugin.settings.OPENAI_MODEL,
			operationName,
			{
				requestPayload: telemetry.isDebugMode() ? { actionId: id } : undefined,
			},
		);

		try {
			// Execute the action
			await action.execute(context);

			// Record successful completion
			// Since we can't directly measure tokens for actions, we'll use the results
			// map to estimate the size of what was generated
			const resultData = context.results.get(id);
			const resultSize = resultData ? JSON.stringify(resultData).length : 0;

			// Estimate token counts based on result size
			// This is a rough estimate as actions don't directly expose token usage
			const promptTokens = 0; // We can't easily track prompt tokens at this level
			const completionTokens = Math.ceil(resultSize / 4); // Roughly 4 chars per token

			telemetry.finishRecording(requestId, {
				promptTokens,
				completionTokens,
				response: telemetry.isDebugMode() ? resultData : undefined,
			});
		} catch (error) {
			// Record error in telemetry
			if (error instanceof Error) {
				telemetry.finishRecording(requestId, {
					promptTokens: 0,
					completionTokens: 0,
					error: error,
				});
			}

			// Re-throw the error to be handled upstream
			throw error;
		}
	}

	async executeMultipleActions(
		actionIds: string[],
		context: ActionContext,
		parallel = false,
	): Promise<void> {
		// Import telemetry here to avoid circular dependencies
		const { telemetry } = require("../telemetry");

		// Start recording telemetry for multiple action execution
		const requestId = telemetry.startRecording(
			context.plugin.settings.OPENAI_MODEL,
			"multiple_actions",
			{
				requestPayload: telemetry.isDebugMode() ? { actionIds } : undefined,
			},
		);

		try {
			const executions = actionIds.map((id) => this.executeAction(id, context));

			if (parallel) {
				await Promise.all(executions);
			} else {
				for (const execution of executions) {
					await execution;
				}
			}

			// Record successful completion
			// We don't have direct token counts, but we can estimate based on results
			let totalResultSize = 0;

			// Collect sizes of all results from executed actions
			for (const id of actionIds) {
				const resultData = context.results.get(id);
				if (resultData) {
					totalResultSize += JSON.stringify(resultData).length;
				}
			}

			// Estimate token usage based on result size
			const completionTokens = Math.ceil(totalResultSize / 4); // ~4 chars per token

			telemetry.finishRecording(requestId, {
				promptTokens: 0, // We can't easily track prompt tokens at this level
				completionTokens,
				response: telemetry.isDebugMode()
					? Object.fromEntries(context.results)
					: undefined,
			});
		} catch (error) {
			// Record error in telemetry
			if (error instanceof Error) {
				telemetry.finishRecording(requestId, {
					promptTokens: 0,
					completionTokens: 0,
					error: error,
				});
			}

			// Re-throw the error to be handled upstream
			throw error;
		}
	}
}
