import { telemetry } from "@/telemetry";

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
		return await fn(requestId, context);
	} catch (error) {
		telemetry.finishRecording(requestId, {
			promptTokens: 0,
			completionTokens: 0,
			error: error instanceof Error ? error : new Error(String(error)),
		});
		throw error;
	}
}
