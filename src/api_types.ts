/**
 * OpenAI API response types for proper type checking
 */

export interface TokenUsageInfo {
	prompt_tokens: number;
	completion_tokens: number;
	total_tokens: number;
}

export interface OpenAIResponse {
	usage?: TokenUsageInfo;
	// Other properties may be included here
}

// Type guard to check if a response has usage info
export function hasUsage(
	response: unknown,
): response is { usage: TokenUsageInfo } {
	// Type to avoid 'any' usage
	interface ResponseWithUsage {
		usage: {
			prompt_tokens: number;
			completion_tokens: number;
			total_tokens: number;
		};
	}

	const typedResponse = response as Partial<ResponseWithUsage>;

	return (
		response !== null &&
		typeof response === "object" &&
		"usage" in response &&
		typedResponse.usage !== undefined &&
		typeof typedResponse.usage === "object" &&
		"prompt_tokens" in typedResponse.usage &&
		"completion_tokens" in typedResponse.usage &&
		"total_tokens" in typedResponse.usage
	);
}

// Type guard for Action response from instructor
export interface ActionResponse {
	action: string;
	necessaryContexts?: string[];
	useEditMode?: boolean;
}

export function isActionResponse(
	response: unknown,
): response is ActionResponse {
	// Type to avoid 'any' usage
	interface ResponseWithAction {
		action: string;
	}

	const typedResponse = response as Partial<ResponseWithAction>;

	return (
		response !== null &&
		typeof response === "object" &&
		"action" in response &&
		typeof typedResponse.action === "string"
	);
}
