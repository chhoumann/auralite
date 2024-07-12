enum LogLevel {
	DEBUG = 0,
	INFO = 1,
	WARN = 2,
	ERROR = 3,
}

interface LogMessage {
	level: LogLevel;
	message: string;
	timestamp: Date;
	context?: Record<string, unknown>;
}

declare const __IS_DEV__: boolean;

class Logger {
	private static instance: Logger;
	private currentLogLevel: LogLevel = __IS_DEV__
		? LogLevel.DEBUG
		: LogLevel.INFO;

	private constructor() {}

	public static getInstance(): Logger {
		if (!Logger.instance) {
			Logger.instance = new Logger();
		}
		return Logger.instance;
	}

	public setLogLevel(level: LogLevel): void {
		this.currentLogLevel = level;
	}

	private log(logMessage: LogMessage): void {
		if (logMessage.level >= this.currentLogLevel) {
			switch (logMessage.level) {
				case LogLevel.DEBUG:
					console.log(logMessage);
					break;
				case LogLevel.INFO:
					console.log(logMessage);
					break;
				case LogLevel.WARN:
					console.warn(logMessage);
					break;
				case LogLevel.ERROR:
					console.error(logMessage);
					break;
				default:
					console.log("Unknown log level", logMessage);
					break;
			}
		}
	}

	public debug(message: string, context?: Record<string, unknown>): void {
		this.log({
			level: LogLevel.DEBUG,
			message,
			timestamp: new Date(),
			context,
		});
	}

	public info(message: string, context?: Record<string, unknown>): void {
		this.log({ level: LogLevel.INFO, message, timestamp: new Date(), context });
	}

	public warn(message: string, context?: Record<string, unknown>): void {
		this.log({ level: LogLevel.WARN, message, timestamp: new Date(), context });
	}

	public error(message: string, context?: Record<string, unknown>): void {
		this.log({
			level: LogLevel.ERROR,
			message,
			timestamp: new Date(),
			context,
		});
	}
}

export const logger = Logger.getInstance();
