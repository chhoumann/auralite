import type { z } from "zod";
import type { Action, ActionContext } from "./Action";

export class ActionManager {
	private actions: Map<string, Action<z.AnyZodObject>> = new Map();

	registerAction(action: Action<z.AnyZodObject>): void {
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
		await action.execute(context);
	}

	async executeMultipleActions(
		actionIds: string[],
		context: ActionContext,
		parallel = false,
	): Promise<void> {
		const executions = actionIds.map((id) => this.executeAction(id, context));

		if (parallel) {
			await Promise.all(executions);
		} else {
			for (const execution of executions) {
				await execution;
			}
		}
	}
}
