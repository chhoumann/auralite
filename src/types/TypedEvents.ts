import { type EventRef, Events } from "obsidian";

export class TypedEvents<T> extends Events {
	/**
	 * @private
	 * @deprecated This property is for internal typing purposes only.
	 * Do not access or use this property under any circumstances.
	 * It is not part of the public API and may be removed without notice.
	 * @internal
	 */
	readonly __events!: T;

	// @ts-ignore
	override on<K extends keyof T>(
		event: K,
		// biome-ignore lint/suspicious/noExplicitAny: Allow any type in this file
		callback: T[K] extends (...args: any[]) => void ? T[K] : never,
		ctx?: unknown,
	): EventRef {
		return super.on(event as string, callback, ctx);
	}

	// @ts-ignore
	override off<K extends keyof T>(
		event: K,
		// biome-ignore lint/suspicious/noExplicitAny: Allow any type in this file
		callback: T[K] extends (...args: any[]) => void ? T[K] : never,
	): void {
		super.off(event as string, callback);
	}

	// @ts-ignore
	override trigger<K extends keyof T>(
		event: K,
		...args: T[K] extends (...args: infer P) => void ? P : never
	): void {
		super.trigger(event as string, ...args);
	}
}
