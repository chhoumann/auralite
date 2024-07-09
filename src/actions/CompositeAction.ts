import { z } from "zod";
import { Action, type ActionContext } from "./Action";

export class CompositeAction extends Action<z.AnyZodObject> {
	readonly description = "Execute multiple actions in sequence or in parallel.";

	private actions: Action<z.AnyZodObject>[];

	constructor(
		id: string,
		actions: Action<z.AnyZodObject>[],
		private parallel = false,
	) {
		super(id, z.object({}), "");
		this.actions = actions;
	}

	override async execute(context: ActionContext): Promise<void> {
		if (this.parallel) {
			await Promise.all(
				this.actions.map((action) => {
					if (context.abortSignal.aborted) {
						throw new Error("Action cancelled");
					}
					return action.execute(context);
				}),
			);
		} else {
			for (const action of this.actions) {
				if (context.abortSignal.aborted) {
					throw new Error("Action cancelled");
				}
				await action.execute(context);
			}
		}
	}

	protected async performAction(
		_input: z.infer<z.AnyZodObject>,
		_context: ActionContext,
	): Promise<void> {}
}
