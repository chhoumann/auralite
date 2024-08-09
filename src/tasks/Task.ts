import type AuralitePlugin from "@/main";
import { TypedEvents } from "@/types/TypedEvents";
import type { EventRef } from "obsidian";
import type { AudioRecorder } from "../AudioRecorder";
import type { ContextBuilder } from "../ContextBuilder";
import type { AIManager } from "../ai";

interface TaskEventMap {
	taskStarted: () => void;
	taskFinished: () => void;
}

type EventProducer = Task | AudioRecorder | AIManager;

type Status =
	| "not started"
	| "started"
	| "stopped"
	| "finished"
	| "cancelled"
	| "error";

export abstract class Task extends TypedEvents<TaskEventMap> {
	public status: Status = "not started";

	protected eventRefs: Map<EventProducer, EventRef[]> = new Map();

	constructor(
		protected plugin: AuralitePlugin,
		protected audioRecorder: AudioRecorder,
		protected contextBuilder: ContextBuilder,
		protected aiManager: AIManager,
	) {
		super();
		this.setupEventListeners();
	}

	start(): void {
		this.status = "started";
		this.trigger("taskStarted");
	}

	stop(): void {
		this.status = "stopped";
	}

	cancel(): void {
		this.finish();
		this.status = "cancelled";
	}

	finish(): void {
		for (const [producer, refs] of this.eventRefs) {
			for (const ref of refs) {
				producer.offref(ref);
			}
		}
		this.eventRefs.clear();
		this.status = "finished";
		this.trigger("taskFinished");
	}

	protected abstract setupEventListeners(): void;

	protected addEvent<P extends EventProducer, E extends keyof P["__events"]>(
		producer: P,
		event: E,
		listener: P["__events"][E],
	): void {
		// @ts-expect-error
		this._addEvent(producer.on(event, listener), producer);
	}

	private _addEvent(ref: EventRef, producer: EventProducer): void {
		if (!this.eventRefs.has(producer)) {
			this.eventRefs.set(producer, []);
		}

		const refs = this.eventRefs.get(producer);

		if (!refs) {
			throw new Error(
				`EventRefs for producer not found. Producer: ${producer.constructor.name}`,
			);
		}

		refs.push(ref);
	}
}
