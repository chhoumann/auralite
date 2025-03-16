/**
 * Telemetry system for tracking token usage and other metrics
 */

import { logger } from "./logging";

export interface TokenUsage {
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
	model: string;
	operation: string;
	editMode?: boolean;
	timestamp: Date;
}

export interface UsageSummary {
	totalPromptTokens: number;
	totalCompletionTokens: number;
	totalTokens: number;
	operationCounts: Record<string, number>;
	modelCounts: Record<string, number>;
	usageByModel: Record<
		string,
		{ promptTokens: number; completionTokens: number; totalTokens: number }
	>;
	estimatedCost: number;
	dailyUsage: Record<string, number>;
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
	// Pricing per 1000 tokens in USD
	private modelPricing: Record<string, ModelPricing> = {
		"gpt-4o": { prompt: 0.005, completion: 0.015 },
		"gpt-4o-mini": { prompt: 0.0015, completion: 0.0045 },
		"whisper-1": { prompt: 0, completion: 0.006 },
		// Default for unknown models
		default: { prompt: 0.001, completion: 0.002 },
	};

	// Get default pricing for unknown models
	private getDefaultPricing(): ModelPricing {
		return this.modelPricing["default"];
	}

	private constructor() {}

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
	 * Record token usage from an operation
	 */
	public recordTokenUsage(usage: Omit<TokenUsage, "timestamp">): void {
		if (!this.enabled) return;

		const usageWithTimestamp: TokenUsage = {
			...usage,
			timestamp: new Date(),
		};

		this.tokenUsage.push(usageWithTimestamp);
		logger.debug("Token usage recorded", { usage: usageWithTimestamp });
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
			totalPromptTokens: 0,
			totalCompletionTokens: 0,
			totalTokens: 0,
			operationCounts: {},
			modelCounts: {},
			usageByModel: {},
			estimatedCost: 0,
			dailyUsage: {},
		};

		for (const usage of this.tokenUsage) {
			summary.totalPromptTokens += usage.promptTokens;
			summary.totalCompletionTokens += usage.completionTokens;
			summary.totalTokens += usage.totalTokens;

			// Count by operation
			summary.operationCounts[usage.operation] =
				(summary.operationCounts[usage.operation] || 0) + 1;

			// Count by model
			summary.modelCounts[usage.model] =
				(summary.modelCounts[usage.model] || 0) + 1;

			// Track usage by model
			if (!summary.usageByModel[usage.model]) {
				summary.usageByModel[usage.model] = {
					promptTokens: 0,
					completionTokens: 0,
					totalTokens: 0,
				};
			}
			summary.usageByModel[usage.model].promptTokens += usage.promptTokens;
			summary.usageByModel[usage.model].completionTokens +=
				usage.completionTokens;
			summary.usageByModel[usage.model].totalTokens += usage.totalTokens;

			// Calculate cost
			const pricing =
				this.modelPricing[usage.model] || this.getDefaultPricing();
			const promptCost = (usage.promptTokens / 1000) * pricing.prompt;
			const completionCost =
				(usage.completionTokens / 1000) * pricing.completion;
			summary.estimatedCost += promptCost + completionCost;

			// Track daily usage
			const date = usage.timestamp.toISOString().split("T")[0];
			summary.dailyUsage[date] =
				(summary.dailyUsage[date] || 0) + usage.totalTokens;
		}

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
}

export const telemetry = Telemetry.getInstance();
