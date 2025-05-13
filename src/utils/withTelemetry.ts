import { telemetry } from "@/telemetry";
import type { TokenUsage } from "@/telemetry";

export interface TelemetryContext {
	sessionId: string;
	actionId: string;
	requestId: string;
	fileName?: string;
	pluginVersion?: string;
	[key: string]: unknown;
}

export async function withTelemetry<T>(
	operationName: string,
	model: string,
	context: TelemetryContext,
	fn: (requestId: string, context: TelemetryContext) => Promise<T>,
	getPayload: () => Record<string, unknown> = () => ({}),
): Promise<T> {
	const requestId = telemetry.startRecording(
		model,
		operationName,
		context,
		getPayload(),
	);
	try {
		const result = await fn(requestId, context);
		telemetry.finishRecording(
			requestId,
			{ success: true, estimated: false },
			context,
		);
		return result;
	} catch (error) {
		telemetry.finishRecording(requestId, { error, estimated: false }, context);
		throw error;
	}
}
