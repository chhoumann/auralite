let sessionId: string | null = null;

export function getOrCreateSessionId(): string {
	if (!sessionId) {
		sessionId =
			typeof crypto !== "undefined" && crypto.randomUUID
				? crypto.randomUUID()
				: Math.random().toString(36).slice(2) + Date.now();
	}
	return sessionId;
}

export function generateRequestId(): string {
	return typeof crypto !== "undefined" && crypto.randomUUID
		? crypto.randomUUID()
		: Math.random().toString(36).slice(2) + Date.now();
}
