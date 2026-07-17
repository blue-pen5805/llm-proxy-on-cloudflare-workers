import { AsyncLocalStorage } from "node:async_hooks";

type LogValue = string | number | boolean | null | undefined;
export type LogFields = Record<string, LogValue>;

interface RequestLogContext {
  method: string;
  path: string;
  requestId: string;
  startedAt: number;
}

const MAX_ERROR_MESSAGE_LENGTH = 500;
const requestLogContext = new AsyncLocalStorage<RequestLogContext>();
const scopedLogFields = new AsyncLocalStorage<LogFields>();

function omitUndefinedLogFields(
  fields: LogFields,
): Record<string, Exclude<LogValue, undefined>> {
  return Object.fromEntries(
    Object.entries(fields).filter(
      (entry): entry is [string, Exclude<LogValue, undefined>] =>
        entry[1] !== undefined,
    ),
  );
}

export function redactLogText(value: string): string {
  const redacted = value
    .replace(/\bBearer\s+\S+/gi, "Bearer ***")
    .replace(
      /([?&](?:api[-_]?key|token|access_token|authorization|password|secret|key)=)[^&#\s]*/gi,
      "$1***",
    )
    .replace(
      /(\b(?:authorization|api[-_]?key|token|secret|password)\b\s*[:=]\s*)[^\s,&]+/gi,
      "$1***",
    );

  return redacted.length > MAX_ERROR_MESSAGE_LENGTH
    ? `${redacted.slice(0, MAX_ERROR_MESSAGE_LENGTH)}…`
    : redacted;
}

function safeErrorFields(error: unknown): LogFields {
  if (!(error instanceof Error)) {
    return {
      error_name: "NonError",
      error_message: "Non-Error value thrown",
    };
  }

  return {
    error_name: error.name,
    error_message: redactLogText(error.message),
  };
}

function logRecord(event: string, fields: LogFields): Record<string, LogValue> {
  return {
    ...omitUndefinedLogFields(scopedLogFields.getStore() ?? {}),
    event,
    request_id: requestLogContext.getStore()?.requestId ?? null,
    ...omitUndefinedLogFields(fields),
  };
}

export class RequestLogger {
  static run<T>(request: Request, callback: () => T): T {
    const requestUrl = new URL(request.url);
    return requestLogContext.run(
      {
        method: request.method,
        path: requestUrl.pathname,
        requestId: request.headers.get("cf-ray") ?? crypto.randomUUID(),
        startedAt: performance.now(),
      },
      callback,
    );
  }

  static info(event: string, fields: LogFields = {}): void {
    console.info(logRecord(event, fields));
  }

  static withFields<T>(fields: LogFields, callback: () => T): T {
    return scopedLogFields.run(
      {
        ...scopedLogFields.getStore(),
        ...omitUndefinedLogFields(fields),
      },
      callback,
    );
  }

  static warn(event: string, fields: LogFields = {}): void {
    console.warn(logRecord(event, fields));
  }

  static error(event: string, error: unknown, fields: LogFields = {}): void {
    console.error(logRecord(event, { ...fields, ...safeErrorFields(error) }));
  }

  static requestFields(): LogFields {
    const logContext = requestLogContext.getStore();
    return {
      method: logContext?.method,
      path: logContext?.path,
    };
  }

  static requestDurationMs(): number {
    const startedAt = requestLogContext.getStore()?.startedAt;
    return startedAt === undefined ? 0 : RequestLogger.durationMs(startedAt);
  }

  static durationMs(startedAt: number): number {
    return Math.max(0, Math.round((performance.now() - startedAt) * 100) / 100);
  }
}
