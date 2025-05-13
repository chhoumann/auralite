/**
 * Telemetry system for tracking token usage and other metrics
 */

import { logger } from "./logging";

export interface TokenUsage {
	// Token counts
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;

	// Request metadata
	model: string;
	operation: string;
	editMode?: boolean;
	isStreaming?: boolean;

	// Contextual telemetry fields
	sessionId?: string;
	actionId?: string;
	requestId?: string; // Unique per logical operation
	fileName?: string;
	pluginVersion?: string;

	// Performance metrics
	timestamp: Date;
	startTime?: number; // ms since epoch when request started
	endTime?: number; // ms since epoch when request completed
	duration?: number; // ms duration of the request (endTime - startTime)

	// Error tracking
	hasError?: boolean;
	errorType?: string;
	errorMessage?: string;

	// Cost metrics
	estimatedCost?: number;

	// Request debugging (optional - only when debug mode is enabled)
	requestPayload?: string; // JSON stringified if in debug mode
}

export interface UsageSummary {
	// Token metrics
	totalPromptTokens: number;
	totalCompletionTokens: number;
	totalTokens: number;

	// Operation metrics
	operationCounts: Record<string, number>;
	modelCounts: Record<string, number>;
	streamingCount: number;
	nonStreamingCount: number;

	// Usage breakdown
	usageByModel: Record<
		string,
		{
			promptTokens: number;
			completionTokens: number;
			totalTokens: number;
			requestCount: number;
			avgDuration?: number;
		}
	>;

	// Cost metrics
	estimatedCost: number;

	// Time-based metrics
	dailyUsage: Record<string, number>;

	// Performance metrics
	avgRequestDuration?: number;
	minRequestDuration?: number;
	maxRequestDuration?: number;

	// Error metrics
	errorCount: number;
	errorRate: number; // percentage of requests that failed
	errorsByType: Record<string, number>;
}

// Model pricing per 1K tokens (in USD)
export interface ModelPricing {
	prompt: number;
	completion: number;
}

export interface TimePeriodUsage {
	period: string;
	totalTokens: number;
	promptTokens: number;
	completionTokens: number;
}

/**
 * Telemetry class for tracking token usage and performance metrics
 */
export class Telemetry {
	private static instance: Telemetry;
	private tokenUsage: TokenUsage[] = [];
	private enabled = true;
	private debugMode = false;
	private maxLogSize = 1000; // Maximum number of records to keep

	// Pricing per 1000 tokens in USD (updated 2025-03-16)
	private modelPricing: Record<string, ModelPricing> = {
		"gpt-4.1": { prompt: 0.002, completion: 0.008 },
		"gpt-4.1-mini": { prompt: 0.0002, completion: 0.0008 },
		"gpt-4.1-nano": { prompt: 0.0001, completion: 0.0004 },
		"gpt-4o": { prompt: 0.005, completion: 0.015 },
		"gpt-4o-mini": { prompt: 0.0005, completion: 0.002 },
		"o4-mini": { prompt: 0.001, completion: 0.004 },
		o3: { prompt: 0.002, completion: 0.008 },
		"o3-mini": { prompt: 0.0005, completion: 0.002 },
		o1: { prompt: 0.001, completion: 0.004 },
		"o1-mini": { prompt: 0.0002, completion: 0.0008 },
		"whisper-1": { prompt: 0, completion: 0.006 },
		// Default for unknown models
		default: { prompt: 0.001, completion: 0.002 },
	};

	// Storage key is not currently used - will be needed if we add persistence
	// outside of the plugin settings

	// Generate a unique ID for each request
	private requestCounter = 0;

	// Get default pricing for unknown models
	private getDefaultPricing(): ModelPricing {
		// Using bracket notation to avoid TypeScript index signature error
		return this.modelPricing.default;
	}

	private constructor() {
		// Rotate logs if they exceed the maximum size
		if (this.tokenUsage.length > this.maxLogSize) {
			logger.info(
				`Telemetry log rotated, keeping last ${this.maxLogSize} records`,
			);
			this.tokenUsage = this.tokenUsage.slice(-this.maxLogSize);
		}
	}

	public static getInstance(): Telemetry {
		if (!Telemetry.instance) {
			Telemetry.instance = new Telemetry();
		}
		return Telemetry.instance;
	}

	/**
	 * Enable or disable telemetry collection
	 */
	public setEnabled(enabled: boolean): void {
		this.enabled = enabled;
		logger.info(`Telemetry ${enabled ? "enabled" : "disabled"}`);
	}

	/**
	 * Enable or disable debug mode for detailed request/response logging
	 */
	public setDebugMode(enabled: boolean): void {
		this.debugMode = enabled;
		logger.info(`Telemetry debug mode ${enabled ? "enabled" : "disabled"}`);
	}

	/**
	 * Is debug mode enabled
	 */
	public isDebugMode(): boolean {
		return this.debugMode;
	}

	/**
	 * Generate a unique request ID
	 */
	public generateRequestId(): string {
		this.requestCounter++;
		return `req_${Date.now()}_${this.requestCounter}`;
	}

	/**
	 * Estimate token count from text
	 */
	public estimateTokenCount(text: string): number {
		if (!text) return 0;
		// Basic estimation: ~4 characters per token as a rough estimate
		return Math.ceil(text.length / 4);
	}

	/**
	 * Record token usage from an operation
	 */
	public recordTokenUsage(usage: Omit<TokenUsage, "timestamp">): void {
		if (!this.enabled) return;

		// Add timestamp and any missing fields
		const now = new Date();
		const usageWithTimestamp: TokenUsage = {
			...usage,
			timestamp: now,
		};

		// Calculate duration if we have start/end times
		if (usageWithTimestamp.startTime && usageWithTimestamp.endTime) {
			usageWithTimestamp.duration =
				usageWithTimestamp.endTime - usageWithTimestamp.startTime;
		}

		// Calculate estimated cost
		if (usageWithTimestamp.estimatedCost === undefined) {
			const pricing =
				this.modelPricing[usage.model] || this.getDefaultPricing();
			usageWithTimestamp.estimatedCost =
				(usage.promptTokens / 1000) * pricing.prompt +
				(usage.completionTokens / 1000) * pricing.completion;
		}

		// Enforce maximum log size
		if (this.tokenUsage.length >= this.maxLogSize) {
			this.tokenUsage.shift(); // Remove oldest entry
		}

		this.tokenUsage.push(usageWithTimestamp);

		// Log level depends on whether there was an error
		if (usageWithTimestamp.hasError) {
			logger.warn("Token usage recorded with error", {
				usage: this.debugMode
					? usageWithTimestamp
					: {
							model: usageWithTimestamp.model,
							operation: usageWithTimestamp.operation,
							errorType: usageWithTimestamp.errorType,
							errorMessage: usageWithTimestamp.errorMessage,
						},
			});
		} else {
			logger.debug("Token usage recorded", {
				usage: this.debugMode
					? usageWithTimestamp
					: {
							model: usageWithTimestamp.model,
							operation: usageWithTimestamp.operation,
							tokens: usageWithTimestamp.totalTokens,
						},
			});
		}
	}

	/**
	 * Get all recorded token usage
	 */
	public getTokenUsage(): TokenUsage[] {
		return [...this.tokenUsage];
	}

	/**
	 * Save token usage data to plugin data
	 */
	public saveTokenUsage(
		saveCallback: (data: TokenUsage[]) => Promise<void>,
	): Promise<void> {
		// Convert Date objects to ISO strings for serialization
		const serializedUsage = this.tokenUsage.map((usage) => ({
			...usage,
			timestamp: usage.timestamp.toISOString(),
		}));

		return saveCallback(serializedUsage as unknown as TokenUsage[]);
	}

	/**
	 * Load token usage data from plugin data
	 */
	public loadTokenUsage(data: unknown): void {
		if (!Array.isArray(data)) {
			logger.warn("Invalid telemetry data format");
			return;
		}

		try {
			// Convert ISO strings back to Date objects
			this.tokenUsage = data.map((item) => ({
				...item,
				timestamp: new Date(item.timestamp),
			})) as TokenUsage[];

			logger.info(`Loaded ${this.tokenUsage.length} telemetry records`);
		} catch (error) {
			logger.error("Error loading telemetry data", { error });
			this.tokenUsage = [];
		}
	}

	/**
	 * Get total token usage summary
	 */
	public getUsageSummary(): UsageSummary {
		const summary: UsageSummary = {
			// Token metrics
			totalPromptTokens: 0,
			totalCompletionTokens: 0,
			totalTokens: 0,

			// Operation metrics
			operationCounts: {},
			modelCounts: {},

			streamingCount: 0,
			nonStreamingCount: 0,

			// Usage breakdown
			usageByModel: {},

			// Cost metrics
			estimatedCost: 0,

			// Time-based metrics
			dailyUsage: {},

			// Performance metrics
			avgRequestDuration: undefined,
			minRequestDuration: undefined,
			maxRequestDuration: undefined,

			// Error metrics
			errorCount: 0,
			errorRate: 0,
			errorsByType: {},
		};

		if (this.tokenUsage.length === 0) {
			return summary;
		}

		let totalDuration = 0;
		let countWithDuration = 0;

		for (const usage of this.tokenUsage) {
			// Calculate token metrics
			summary.totalPromptTokens += usage.promptTokens;
			summary.totalCompletionTokens += usage.completionTokens;
			summary.totalTokens += usage.totalTokens;

			// Count by operation
			summary.operationCounts[usage.operation] =
				(summary.operationCounts[usage.operation] || 0) + 1;

			// Count by model
			summary.modelCounts[usage.model] =
				(summary.modelCounts[usage.model] || 0) + 1;

			// Count streaming vs non-streaming
			if (usage.isStreaming) {
				summary.streamingCount++;
			} else {
				summary.nonStreamingCount++;
			}

			// Track usage by model
			if (!summary.usageByModel[usage.model]) {
				summary.usageByModel[usage.model] = {
					promptTokens: 0,
					completionTokens: 0,
					totalTokens: 0,
					requestCount: 0,
					avgDuration: undefined,
				};
			}

			const modelStats = summary.usageByModel[usage.model];
			modelStats.promptTokens += usage.promptTokens;
			modelStats.completionTokens += usage.completionTokens;
			modelStats.totalTokens += usage.totalTokens;
			modelStats.requestCount++;

			// Performance tracking
			if (usage.duration !== undefined) {
				// Overall duration statistics
				totalDuration += usage.duration;
				countWithDuration++;

				if (
					summary.minRequestDuration === undefined ||
					usage.duration < summary.minRequestDuration
				) {
					summary.minRequestDuration = usage.duration;
				}

				if (
					summary.maxRequestDuration === undefined ||
					usage.duration > summary.maxRequestDuration
				) {
					summary.maxRequestDuration = usage.duration;
				}

				// Per-model duration tracking
				if (modelStats.avgDuration === undefined) {
					modelStats.avgDuration = usage.duration;
				} else {
					modelStats.avgDuration =
						(modelStats.avgDuration * (modelStats.requestCount - 1) +
							usage.duration) /
						modelStats.requestCount;
				}
			}

			// Error tracking
			if (usage.hasError) {
				summary.errorCount++;

				const errorType = usage.errorType || "unknown";
				summary.errorsByType[errorType] =
					(summary.errorsByType[errorType] || 0) + 1;
			}

			// Cost calculation (use pre-calculated cost if available)
			if (usage.estimatedCost !== undefined) {
				summary.estimatedCost += usage.estimatedCost;
			} else {
				const pricing =
					this.modelPricing[usage.model] || this.getDefaultPricing();
				const promptCost = (usage.promptTokens / 1000) * pricing.prompt;
				const completionCost =
					(usage.completionTokens / 1000) * pricing.completion;
				summary.estimatedCost += promptCost + completionCost;
			}

			// Track daily usage
			const date = usage.timestamp.toISOString().split("T")[0];
			summary.dailyUsage[date] =
				(summary.dailyUsage[date] || 0) + usage.totalTokens;
		}

		// Calculate average duration if we have duration data
		if (countWithDuration > 0) {
			summary.avgRequestDuration = totalDuration / countWithDuration;
		}

		// Calculate error rate
		summary.errorRate =
			this.tokenUsage.length > 0
				? (summary.errorCount / this.tokenUsage.length) * 100
				: 0;

		return summary;
	}

	/**
	 * Estimate cost of token usage
	 */
	public estimateCost(
		modelName: string,
		promptTokens: number,
		completionTokens: number,
	): number {
		const pricing = this.modelPricing[modelName] || this.getDefaultPricing();
		return (
			(promptTokens / 1000) * pricing.prompt +
			(completionTokens / 1000) * pricing.completion
		);
	}

	/**
	 * Get token usage aggregated by time period (e.g., 'day', 'week', 'month')
	 */
	public getUsageByTimePeriod(
		period: "day" | "week" | "month",
	): TimePeriodUsage[] {
		const periodsMap: Record<string, TimePeriodUsage> = {};

		for (const usage of this.tokenUsage) {
			let periodKey: string;
			const date = new Date(usage.timestamp);

			if (period === "day") {
				periodKey = date.toISOString().split("T")[0]; // YYYY-MM-DD
			} else if (period === "week") {
				// Get week number and year
				const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
				const daysSinceFirstDay = Math.floor(
					(date.getTime() - firstDayOfYear.getTime()) / (24 * 60 * 60 * 1000),
				);
				const weekNumber = Math.ceil(
					(daysSinceFirstDay + firstDayOfYear.getDay() + 1) / 7,
				);
				periodKey = `${date.getFullYear()}-W${weekNumber}`;
			} else {
				// month
				periodKey = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, "0")}`;
			}

			if (!periodsMap[periodKey]) {
				periodsMap[periodKey] = {
					period: periodKey,
					totalTokens: 0,
					promptTokens: 0,
					completionTokens: 0,
				};
			}

			periodsMap[periodKey].totalTokens += usage.totalTokens;
			periodsMap[periodKey].promptTokens += usage.promptTokens;
			periodsMap[periodKey].completionTokens += usage.completionTokens;
		}

		// Convert to array and sort by period
		return Object.values(periodsMap).sort((a, b) =>
			a.period.localeCompare(b.period),
		);
	}

	/**
	 * Export telemetry data to CSV format
	 */
	public exportToCSV(): string {
		if (this.tokenUsage.length === 0) {
			return "No data to export";
		}

		// CSV headers
		const headers = [
			"Timestamp",
			"Model",
			"Operation",
			"Edit Mode",
			"Prompt Tokens",
			"Completion Tokens",
			"Total Tokens",
			"Est. Cost ($)",
		];

		// Create CSV rows
		const rows = this.tokenUsage.map((usage) => {
			const pricing =
				this.modelPricing[usage.model] || this.getDefaultPricing();
			const cost =
				(usage.promptTokens / 1000) * pricing.prompt +
				(usage.completionTokens / 1000) * pricing.completion;

			return [
				usage.timestamp.toISOString(),
				usage.model,
				usage.operation,
				usage.editMode ? "Yes" : "No",
				usage.promptTokens,
				usage.completionTokens,
				usage.totalTokens,
				cost.toFixed(6),
			];
		});

		// Join headers and rows
		return [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");
	}

	/**
	 * Clear all token usage data
	 */
	public clearTokenUsage(): void {
		this.tokenUsage = [];
		logger.info("Token usage data cleared");
	}

	/**
	 * Get recent token usage (last n records)
	 */
	public getRecentTokenUsage(count: number): TokenUsage[] {
		return this.tokenUsage.slice(Math.max(0, this.tokenUsage.length - count));
	}

	/**
	 * Get token usage for a specific time period
	 */
	public getTokenUsageInPeriod(startTime: Date, endTime: Date): TokenUsage[] {
		return this.tokenUsage.filter(
			(usage) => usage.timestamp >= startTime && usage.timestamp <= endTime,
		);
	}

	/**
	 * Start recording an API call - returns a request ID to use with finishRecording
	 */
	public startRecording(
		model: string,
		operation: string,
		context?: {
			sessionId?: string;
			actionId?: string;
			requestId?: string;
			fileName?: string;
			pluginVersion?: string;
		},
		options?: {
			isStreaming?: boolean;
			editMode?: boolean;
			requestPayload?: unknown;
		},
	): string {
		const requestId = context?.requestId || this.generateRequestId();

		if (this.debugMode && options?.requestPayload) {
			logger.debug(`Starting API call ${requestId}`, {
				model,
				operation,
				payload: options.requestPayload,
			});
		}

		const startTime = Date.now();

		this.activeRequests.set(requestId, {
			startTime,
			model,
			operation,
			isStreaming: options?.isStreaming ?? false,
			editMode: options?.editMode ?? false,
			requestPayload:
				this.debugMode && options?.requestPayload
					? JSON.stringify(options.requestPayload)
					: undefined,
			// Context fields
			sessionId: context?.sessionId,
			actionId: context?.actionId,
			fileName: context?.fileName,
			pluginVersion: context?.pluginVersion,
		});

		return requestId;
	}

	/**
	 * Finish recording an API call and save the telemetry data
	 */
	public finishRecording(
		requestId: string,
		result: {
			promptTokens: number;
			completionTokens: number;
			totalTokens?: number;
			error?: Error;
			response?: unknown;
		},
	): void {
		if (!this.enabled && !this.activeRequests.has(requestId)) {
			return;
		}

		const endTime = Date.now();
		const requestInfo = this.activeRequests.get(requestId);

		if (!requestInfo) {
			logger.warn(`No request found with ID ${requestId}`);
			return;
		}

		this.activeRequests.delete(requestId);

		const totalTokens =
			result.totalTokens ?? result.promptTokens + result.completionTokens;

		const pricing =
			this.modelPricing[requestInfo.model] || this.getDefaultPricing();
		const estimatedCost =
			(result.promptTokens / 1000) * pricing.prompt +
			(result.completionTokens / 1000) * pricing.completion;

		const hasError = !!result.error;

		if (this.debugMode) {
			if (hasError) {
				logger.warn(
					`API call ${requestId} failed after ${endTime - requestInfo.startTime}ms`,
					{
						error: result.error,
						model: requestInfo.model,
						operation: requestInfo.operation,
						tokens: totalTokens,
					},
				);
			} else {
				logger.debug(
					`API call ${requestId} completed in ${endTime - requestInfo.startTime}ms`,
					{
						model: requestInfo.model,
						operation: requestInfo.operation,
						tokens: totalTokens,
						response: result.response,
					},
				);
			}
		}

		this.recordTokenUsage({
			promptTokens: result.promptTokens,
			completionTokens: result.completionTokens,
			totalTokens,
			model: requestInfo.model,
			operation: requestInfo.operation,
			editMode: requestInfo.editMode,
			isStreaming: requestInfo.isStreaming,
			// Context fields
			sessionId: requestInfo.sessionId,
			actionId: requestInfo.actionId,
			requestId,
			fileName: requestInfo.fileName,
			pluginVersion: requestInfo.pluginVersion,
			startTime: requestInfo.startTime,
			endTime,
			duration: endTime - requestInfo.startTime,
			hasError,
			errorType: hasError ? result.error?.name : undefined,
			errorMessage: hasError ? result.error?.message : undefined,
			estimatedCost,
			requestPayload: requestInfo.requestPayload,
		});
	}

	// Track active requests
	private activeRequests = new Map<
		string,
		{
			startTime: number;
			model: string;
			operation: string;
			isStreaming?: boolean;
			editMode?: boolean;
			requestPayload?: string;
			sessionId?: string;
			actionId?: string;
			fileName?: string;
			pluginVersion?: string;
		}
	>();
}

export const telemetry = Telemetry.getInstance();
