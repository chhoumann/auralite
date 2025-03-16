import { Modal, Notice } from "obsidian";
import { type TimePeriodUsage, telemetry } from "./telemetry";

export class TelemetryModal extends Modal {
	private currentView: "summary" | "daily" | "weekly" | "monthly" | "performance" | "errors" = "summary";

	override onOpen() {
		this.renderView();
	}

	private renderView() {
		const { contentEl } = this;
		contentEl.empty();

		// Modal title and navigation
		contentEl.createEl("h2", { text: "Token Usage Statistics" });

		// Add view navigation
		const navDiv = contentEl.createEl("div", { cls: "telemetry-nav" });

		const views = [
			{ id: "summary", label: "Summary" },
			{ id: "daily", label: "Daily" },
			{ id: "weekly", label: "Weekly" },
			{ id: "monthly", label: "Monthly" },
			{ id: "performance", label: "Performance" },
			{ id: "errors", label: "Errors" }
		];
		
		for (const view of views) {
			const button = navDiv.createEl("button", {
				text: view.label,
				cls: this.currentView === view.id ? "is-active" : "",
			});
			button.addEventListener("click", () => {
				this.currentView = view.id as typeof this.currentView;
				this.renderView();
			});
		}

		// Export button
		const actionDiv = contentEl.createEl("div", { cls: "telemetry-actions" });
		const exportButton = actionDiv.createEl("button", {
			text: "Export CSV",
			cls: "mod-cta",
		});
		exportButton.addEventListener("click", () => this.exportTelemetry());

		// Render the current view
		switch (this.currentView) {
			case "summary":
				this.renderSummaryView(contentEl);
				break;
			case "daily":
				this.renderTimeBasedView(contentEl, "day");
				break;
			case "weekly":
				this.renderTimeBasedView(contentEl, "week");
				break;
			case "monthly":
				this.renderTimeBasedView(contentEl, "month");
				break;
			case "performance":
				this.renderPerformanceView(contentEl);
				break;
			case "errors":
				this.renderErrorsView(contentEl);
				break;
		}

		// Add CSS for styling
		this.addStyles(contentEl);
	}

	private renderSummaryView(contentEl: HTMLElement) {
		// Get summary data
		const summary = telemetry.getUsageSummary();
		const recentUsage = telemetry.getRecentTokenUsage(10); // Last 10 operations

		// Create summary section
		const summarySection = contentEl.createEl("div", {
			cls: "telemetry-summary",
		});
		summarySection.createEl("h3", { text: "Usage Summary" });

		const summaryTable = summarySection.createEl("table");
		const headerRow = summaryTable.createEl("tr");
		headerRow.createEl("th", { text: "Metric" });
		headerRow.createEl("th", { text: "Value" });

		// Add summary rows
		this.addTableRow(
			summaryTable,
			"Total Prompt Tokens",
			summary.totalPromptTokens.toLocaleString(),
		);
		this.addTableRow(
			summaryTable,
			"Total Completion Tokens",
			summary.totalCompletionTokens.toLocaleString(),
		);
		this.addTableRow(
			summaryTable,
			"Total Tokens",
			summary.totalTokens.toLocaleString(),
		);
		this.addTableRow(
			summaryTable,
			"Total Operations",
			Object.values(summary.operationCounts)
				.reduce((a, b) => a + b, 0)
				.toLocaleString(),
		);
		this.addTableRow(
			summaryTable,
			"Estimated Cost",
			`$${summary.estimatedCost.toFixed(4)}`,
		);

		// Create models section
		const modelsSection = contentEl.createEl("div", {
			cls: "telemetry-models",
		});
		modelsSection.createEl("h3", { text: "Usage by Model" });

		const modelsTable = modelsSection.createEl("table");
		const modelHeaderRow = modelsTable.createEl("tr");
		modelHeaderRow.createEl("th", { text: "Model" });
		modelHeaderRow.createEl("th", { text: "Operations" });
		modelHeaderRow.createEl("th", { text: "Prompt Tokens" });
		modelHeaderRow.createEl("th", { text: "Completion Tokens" });
		modelHeaderRow.createEl("th", { text: "Total Tokens" });
		modelHeaderRow.createEl("th", { text: "Est. Cost" });

		// Add model rows
		for (const model in summary.usageByModel) {
			const modelRow = modelsTable.createEl("tr");
			modelRow.createEl("td", { text: model });
			modelRow.createEl("td", {
				text: (summary.modelCounts[model] || 0).toLocaleString(),
			});
			modelRow.createEl("td", {
				text: summary.usageByModel[model].promptTokens.toLocaleString(),
			});
			modelRow.createEl("td", {
				text: summary.usageByModel[model].completionTokens.toLocaleString(),
			});
			modelRow.createEl("td", {
				text: summary.usageByModel[model].totalTokens.toLocaleString(),
			});

			// Calculate cost for this model
			const cost = telemetry.estimateCost(
				model,
				summary.usageByModel[model].promptTokens,
				summary.usageByModel[model].completionTokens,
			);
			modelRow.createEl("td", {
				text: `$${cost.toFixed(4)}`,
			});
		}

		// Create operations section
		const operationsSection = contentEl.createEl("div", {
			cls: "telemetry-operations",
		});
		operationsSection.createEl("h3", { text: "Usage by Operation" });

		const operationsTable = operationsSection.createEl("table");
		const opHeaderRow = operationsTable.createEl("tr");
		opHeaderRow.createEl("th", { text: "Operation" });
		opHeaderRow.createEl("th", { text: "Count" });

		// Add operation rows
		for (const operation in summary.operationCounts) {
			this.addTableRow(
				operationsTable,
				operation,
				summary.operationCounts[operation].toLocaleString(),
			);
		}

		// Recent operations
		const recentSection = contentEl.createEl("div", {
			cls: "telemetry-recent",
		});
		recentSection.createEl("h3", { text: "Recent Operations" });

		if (recentUsage.length > 0) {
			const recentTable = recentSection.createEl("table");
			const recentHeaderRow = recentTable.createEl("tr");
			recentHeaderRow.createEl("th", { text: "Time" });
			recentHeaderRow.createEl("th", { text: "Operation" });
			recentHeaderRow.createEl("th", { text: "Model" });
			recentHeaderRow.createEl("th", { text: "Edit Mode" });
			recentHeaderRow.createEl("th", { text: "Tokens" });
			recentHeaderRow.createEl("th", { text: "Est. Cost" });

			// Add recent operations
			for (const usage of recentUsage.reverse()) {
				const row = recentTable.createEl("tr");
				row.createEl("td", { text: this.formatTime(usage.timestamp) });
				row.createEl("td", { text: usage.operation });
				row.createEl("td", { text: usage.model });
				row.createEl("td", { text: usage.editMode ? "Yes" : "No" });
				row.createEl("td", {
					text: `${usage.totalTokens.toLocaleString()} (${usage.promptTokens.toLocaleString()}/${usage.completionTokens.toLocaleString()})`,
				});

				// Calculate and show cost
				const cost = telemetry.estimateCost(
					usage.model,
					usage.promptTokens,
					usage.completionTokens,
				);
				row.createEl("td", {
					text: `$${cost.toFixed(6)}`,
				});
			}
		} else {
			recentSection.createEl("p", { text: "No operations recorded yet." });
		}
	}

	private renderTimeBasedView(
		contentEl: HTMLElement,
		period: "day" | "week" | "month",
	) {
		const periodData = telemetry.getUsageByTimePeriod(period);

		if (periodData.length === 0) {
			contentEl.createEl("p", {
				text: "No data available for this time period.",
				cls: "telemetry-no-data",
			});
			return;
		}

		// Title based on period
		const periodTitle =
			period === "day" ? "Daily" : period === "week" ? "Weekly" : "Monthly";
		const timeSection = contentEl.createEl("div", {
			cls: "telemetry-time-period",
		});
		timeSection.createEl("h3", { text: `${periodTitle} Token Usage` });

		// Create table
		const timeTable = timeSection.createEl("table");
		const timeHeaderRow = timeTable.createEl("tr");
		timeHeaderRow.createEl("th", {
			text: period === "day" ? "Date" : period === "week" ? "Week" : "Month",
		});
		timeHeaderRow.createEl("th", { text: "Prompt Tokens" });
		timeHeaderRow.createEl("th", { text: "Completion Tokens" });
		timeHeaderRow.createEl("th", { text: "Total Tokens" });

		// Add rows for each time period
		for (const periodItem of periodData) {
			const row = timeTable.createEl("tr");
			row.createEl("td", {
				text: this.formatPeriodLabel(periodItem.period, period),
			});
			row.createEl("td", { text: periodItem.promptTokens.toLocaleString() });
			row.createEl("td", {
				text: periodItem.completionTokens.toLocaleString(),
			});
			row.createEl("td", { text: periodItem.totalTokens.toLocaleString() });
		}

		// Create a simple bar chart visualization
		this.renderBarChart(contentEl, periodData, period);
	}

	private renderBarChart(
		contentEl: HTMLElement,
		data: TimePeriodUsage[],
		period: "day" | "week" | "month",
	) {
		const chartSection = contentEl.createEl("div", { cls: "telemetry-chart" });
		chartSection.createEl("h3", { text: "Token Usage Visualization" });

		const chartContainer = chartSection.createEl("div", {
			cls: "chart-container",
		});

		// Find max value for scaling
		const maxValue = Math.max(...data.map((item) => item.totalTokens));

		// Create bars
		for (const item of data) {
			const barContainer = chartContainer.createEl("div", {
				cls: "bar-container",
			});

			// Calculate heights based on percentage of max
			const promptHeight = maxValue
				? (item.promptTokens / maxValue) * 100
				: 0;
			const completionHeight = maxValue
				? (item.completionTokens / maxValue) * 100
				: 0;

			// Create stacked bars
			const promptBar = barContainer.createEl("div", {
				cls: "bar prompt-bar",
				attr: { "data-value": item.promptTokens.toLocaleString() },
			});
			promptBar.style.height = `${promptHeight}%`;

			const completionBar = barContainer.createEl("div", {
				cls: "bar completion-bar",
				attr: { "data-value": item.completionTokens.toLocaleString() },
			});
			completionBar.style.height = `${completionHeight}%`;

			// Add label
			barContainer.createEl("div", {
				cls: "bar-label",
				text: this.formatPeriodLabel(item.period, period, true),
			});
		}

		// Add legend
		const legend = chartSection.createEl("div", { cls: "chart-legend" });
		const promptLegend = legend.createEl("div", { cls: "legend-item" });
		promptLegend.createEl("div", { cls: "legend-color prompt-color" });
		promptLegend.createEl("span", { text: "Prompt Tokens" });

		const completionLegend = legend.createEl("div", { cls: "legend-item" });
		completionLegend.createEl("div", { cls: "legend-color completion-color" });
		completionLegend.createEl("span", { text: "Completion Tokens" });
	}

	private formatPeriodLabel(
		period: string,
		periodType: "day" | "week" | "month",
		short = false,
	): string {
		if (periodType === "day") {
			// Format: YYYY-MM-DD to more readable date
			const date = new Date(period);
			if (short) {
				return date.toLocaleDateString(undefined, {
					month: "2-digit",
					day: "2-digit",
				});
			}
			return date.toLocaleDateString(undefined, {
				year: "numeric",
				month: "short",
				day: "numeric",
			});
		}
		if (periodType === "week") {
			// Format: YYYY-WXX
			const [year, week] = period.split("-W");
			if (short) {
				return `W${week}`;
			}
			return `Week ${week}, ${year}`;
		}
		// Format: YYYY-MM
		const [year, month] = period.split("-");
		const date = new Date(
			Number.parseInt(year),
			Number.parseInt(month) - 1,
		);
		if (short) {
			return date.toLocaleDateString(undefined, { month: "short" });
		}
		return date.toLocaleDateString(undefined, {
			year: "numeric",
			month: "long",
		});
	}

	private async exportTelemetry() {
		try {
			const csvContent = telemetry.exportToCSV();

			if (csvContent === "No data to export") {
				new Notice("No telemetry data to export");
				return;
			}

			// Create and save the file
			const fileName = `auralite-telemetry-${
				new Date().toISOString().split("T")[0]
			}.csv`;
			const adapter = this.app.vault.adapter;

			// Save in the root of the vault
			const filePath = `${fileName}`;
			await adapter.write(filePath, csvContent);

			// Show success message with path
			new Notice(`Telemetry data exported to ${filePath}`);
		} catch (error) {
			console.error("Error exporting telemetry data", error);
			new Notice("Failed to export telemetry data");
		}
	}

	override onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}

	private addTableRow(
		table: HTMLTableElement,
		key: string,
		value: string,
	) {
		const row = table.createEl("tr");
		row.createEl("td", { text: key });
		row.createEl("td", { text: value });
		return row;
	}

	private renderPerformanceView(contentEl: HTMLElement) {
		const summary = telemetry.getUsageSummary();
		const hasData = telemetry.getTokenUsage().length > 0;
		
		if (!hasData) {
			contentEl.createEl("p", {
				text: "No performance data available.",
				cls: "telemetry-no-data"
			});
			return;
		}
		
		// Header section
		const perfHeader = contentEl.createEl("div", { cls: "telemetry-perf-header" });
		perfHeader.createEl("h3", { text: "Request Performance" });
		
		// Overall metrics
		const overallSection = contentEl.createEl("div", { cls: "telemetry-perf-overall" });
		const overallTable = overallSection.createEl("table");
		
		// Add overall metrics
		this.addTableRow(overallTable, "Total Requests", 
			(summary.streamingCount + summary.nonStreamingCount).toString());
		this.addTableRow(overallTable, "Streaming Requests", summary.streamingCount.toString());
		this.addTableRow(overallTable, "Non-Streaming Requests", summary.nonStreamingCount.toString());
		
		if (summary.avgRequestDuration !== undefined) {
			this.addTableRow(overallTable, "Average Duration", 
				`${Math.round(summary.avgRequestDuration)}ms`);
			
			this.addTableRow(overallTable, "Min Duration", 
				`${Math.round(summary.minRequestDuration || 0)}ms`);
				
			this.addTableRow(overallTable, "Max Duration", 
				`${Math.round(summary.maxRequestDuration || 0)}ms`);
		} else {
			this.addTableRow(overallTable, "Performance Data", "No duration data available");
		}
		
		// Per-model performance
		const modelsSection = contentEl.createEl("div", { cls: "telemetry-perf-models" });
		modelsSection.createEl("h3", { text: "Performance by Model" });
		
		const modelsTable = modelsSection.createEl("table");
		const modelHeaderRow = modelsTable.createEl("tr");
		modelHeaderRow.createEl("th", { text: "Model" });
		modelHeaderRow.createEl("th", { text: "Requests" });
		modelHeaderRow.createEl("th", { text: "Avg. Tokens" });
		modelHeaderRow.createEl("th", { text: "Avg. Duration" });
		modelHeaderRow.createEl("th", { text: "Tokens/Second" });
		
		// Add model performance rows
		for (const model in summary.usageByModel) {
			const stats = summary.usageByModel[model];
			const modelRow = modelsTable.createEl("tr");
			
			modelRow.createEl("td", { text: model });
			modelRow.createEl("td", { text: stats.requestCount.toString() });
			
			// Calculate average tokens per request
			const avgTokens = stats.requestCount > 0 
				? Math.round(stats.totalTokens / stats.requestCount) 
				: 0;
			modelRow.createEl("td", { text: avgTokens.toString() });
			
			// Duration data
			if (stats.avgDuration !== undefined) {
				modelRow.createEl("td", { text: `${Math.round(stats.avgDuration)}ms` });
				
				// Calculate throughput (tokens per second)
				const tokensPerSecond = stats.avgDuration > 0 
					? Math.round((avgTokens / stats.avgDuration) * 1000) 
					: 0;
				modelRow.createEl("td", { text: tokensPerSecond.toString() });
			} else {
				modelRow.createEl("td", { text: "N/A" });
				modelRow.createEl("td", { text: "N/A" });
			}
		}
		
		// Recent requests with performance data
		const recentSection = contentEl.createEl("div", { cls: "telemetry-perf-recent" });
		recentSection.createEl("h3", { text: "Recent Requests" });
		
		const recentRequests = telemetry.getRecentTokenUsage(10)
			.filter(usage => usage.duration !== undefined)
			.sort((a, b) => (b.timestamp?.getTime() || 0) - (a.timestamp?.getTime() || 0));
		
		if (recentRequests.length > 0) {
			const recentTable = recentSection.createEl("table");
			const recentHeader = recentTable.createEl("tr");
			recentHeader.createEl("th", { text: "Time" });
			recentHeader.createEl("th", { text: "Model" });
			recentHeader.createEl("th", { text: "Operation" });
			recentHeader.createEl("th", { text: "Tokens" });
			recentHeader.createEl("th", { text: "Duration" });
			recentHeader.createEl("th", { text: "Tokens/Second" });
			
			for (const req of recentRequests) {
				const row = recentTable.createEl("tr");
				row.createEl("td", { text: this.formatTime(req.timestamp) });
				row.createEl("td", { text: req.model });
				row.createEl("td", { text: req.operation });
				row.createEl("td", { text: req.totalTokens.toString() });
				row.createEl("td", { text: `${req.duration}ms` });
				
				// Calculate throughput
				const tokensPerSecond = req.duration && req.duration > 0 
					? Math.round((req.totalTokens / req.duration) * 1000) 
					: 0;
				row.createEl("td", { text: tokensPerSecond.toString() });
			}
		} else {
			recentSection.createEl("p", { text: "No recent performance data available" });
		}
	}
	
	private renderErrorsView(contentEl: HTMLElement) {
		const summary = telemetry.getUsageSummary();
		const hasData = telemetry.getTokenUsage().length > 0;
		
		if (!hasData || summary.errorCount === 0) {
			contentEl.createEl("p", {
				text: "No error data available.",
				cls: "telemetry-no-data"
			});
			return;
		}
		
		// Header section
		const errorHeader = contentEl.createEl("div", { cls: "telemetry-error-header" });
		errorHeader.createEl("h3", { text: "Error Statistics" });
		
		// Overall metrics
		const overallSection = contentEl.createEl("div", { cls: "telemetry-error-overall" });
		const overallTable = overallSection.createEl("table");
		
		// Add overall metrics
		this.addTableRow(overallTable, "Total Requests", 
			(summary.streamingCount + summary.nonStreamingCount).toString());
		this.addTableRow(overallTable, "Failed Requests", summary.errorCount.toString());
		this.addTableRow(overallTable, "Error Rate", 
			`${summary.errorRate.toFixed(2)}%`);
			
		// Error types
		const typesSection = contentEl.createEl("div", { cls: "telemetry-error-types" });
		typesSection.createEl("h3", { text: "Errors by Type" });
		
		const typesTable = typesSection.createEl("table");
		const typeHeader = typesTable.createEl("tr");
		typeHeader.createEl("th", { text: "Error Type" });
		typeHeader.createEl("th", { text: "Count" });
		typeHeader.createEl("th", { text: "Percentage" });
		
		// Add error type rows
		for (const errorType in summary.errorsByType) {
			const count = summary.errorsByType[errorType];
			const row = typesTable.createEl("tr");
			row.createEl("td", { text: errorType });
			row.createEl("td", { text: count.toString() });
			row.createEl("td", { 
				text: `${((count / summary.errorCount) * 100).toFixed(1)}%` 
			});
		}
		
		// Recent errors
		const recentSection = contentEl.createEl("div", { cls: "telemetry-error-recent" });
		recentSection.createEl("h3", { text: "Recent Errors" });
		
		const recentErrors = telemetry.getRecentTokenUsage(20)
			.filter(usage => usage.hasError)
			.sort((a, b) => (b.timestamp?.getTime() || 0) - (a.timestamp?.getTime() || 0));
		
		if (recentErrors.length > 0) {
			const recentTable = recentSection.createEl("table");
			const recentHeader = recentTable.createEl("tr");
			recentHeader.createEl("th", { text: "Time" });
			recentHeader.createEl("th", { text: "Model" });
			recentHeader.createEl("th", { text: "Operation" });
			recentHeader.createEl("th", { text: "Error Type" });
			recentHeader.createEl("th", { text: "Error Message" });
			
			for (const error of recentErrors) {
				const row = recentTable.createEl("tr");
				row.createEl("td", { text: this.formatTime(error.timestamp) });
				row.createEl("td", { text: error.model });
				row.createEl("td", { text: error.operation });
				row.createEl("td", { text: error.errorType || "unknown" });
				row.createEl("td", { text: error.errorMessage || "No message" });
			}
		} else {
			recentSection.createEl("p", { text: "No recent errors available" });
		}
	}
	
	private formatTime(date: Date): string {
		return date.toLocaleTimeString([], {
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hour12: false,
		});
	}

	private addStyles(contentEl: HTMLElement) {
		contentEl.createEl("style", {
			text: `
				.telemetry-summary, .telemetry-models, .telemetry-operations, .telemetry-recent, .telemetry-time-period, .telemetry-chart,
.telemetry-perf-header, .telemetry-perf-overall, .telemetry-perf-models, .telemetry-perf-recent,
.telemetry-error-header, .telemetry-error-overall, .telemetry-error-types, .telemetry-error-recent {
					margin-bottom: 20px;
					overflow-x: auto;
				}
				
				.telemetry-nav, .telemetry-actions {
					display: flex;
					margin-bottom: 20px;
					gap: 10px;
				}
				
				button {
					padding: 6px 12px;
					border-radius: 4px;
					background-color: var(--background-secondary);
					border: 1px solid var(--background-modifier-border);
					color: var(--text-normal);
					cursor: pointer;
				}
				
				button:hover {
					background-color: var(--background-secondary-alt);
				}
				
				button.is-active {
					background-color: var(--interactive-accent);
					color: var(--text-on-accent);
				}
				
				button.mod-cta {
					background-color: var(--interactive-accent);
					color: var(--text-on-accent);
				}
				
				table {
					border-collapse: collapse;
					width: 100%;
				}
				
				th, td {
					border: 1px solid var(--background-modifier-border);
					padding: 8px;
					text-align: left;
				}
				
				th {
					background-color: var(--background-secondary);
				}
				
				tr:nth-child(even) {
					background-color: var(--background-primary);
				}
				
				tr:nth-child(odd) {
					background-color: var(--background-secondary-alt);
				}
				
				.chart-container {
					display: flex;
					justify-content: space-between;
					align-items: flex-end;
					height: 200px;
					margin-top: 20px;
					gap: 5px;
				}
				
				.bar-container {
					display: flex;
					flex-direction: column;
					align-items: center;
					flex: 1;
					min-width: 30px;
				}
				
				.bar {
					width: 100%;
					position: relative;
				}
				
				.bar::after {
					content: attr(data-value);
					position: absolute;
					bottom: 100%;
					left: 50%;
					transform: translateX(-50%);
					font-size: 10px;
					opacity: 0;
					transition: opacity 0.2s;
					white-space: nowrap;
					background: var(--background-primary);
					padding: 2px 4px;
					border-radius: 2px;
				}
				
				.bar:hover::after {
					opacity: 1;
				}
				
				.prompt-bar {
					background-color: var(--color-blue);
				}
				
				.completion-bar {
					background-color: var(--color-green);
					margin-top: 1px;
				}
				
				.bar-label {
					margin-top: 5px;
					font-size: 10px;
					text-align: center;
					transform: rotate(-45deg);
					white-space: nowrap;
					max-width: 100px;
				}
				
				.chart-legend {
					display: flex;
					justify-content: center;
					margin-top: 20px;
					gap: 20px;
				}
				
				.legend-item {
					display: flex;
					align-items: center;
					gap: 5px;
				}
				
				.legend-color {
					width: 15px;
					height: 15px;
					border-radius: 3px;
				}
				
				.prompt-color {
					background-color: var(--color-blue);
				}
				
				.completion-color {
					background-color: var(--color-green);
				}
				
				.telemetry-no-data {
					text-align: center;
					margin: 40px 0;
					font-style: italic;
				}
			`,
		});
	}
}