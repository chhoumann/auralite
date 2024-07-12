import { z } from "zod";
import { Action, type ActionContext } from "./Action";
import { logger } from "@/logging";

export class NoopAction extends Action<typeof NoopAction.inputSchema> {
	readonly description =
		"This action does nothing and is used when no specific action is required.";

	static inputSchema = z.object({});

	constructor() {
		super(
			"none",
			NoopAction.inputSchema,
			"This action does nothing and is used when no specific action is required.",
		);
	}

	protected async performAction(
		_input: z.infer<typeof NoopAction.inputSchema>,
		_context: ActionContext,
	): Promise<void> {
		// This action intentionally does nothing
		logger.debug("Noop action executed");
	}
}
