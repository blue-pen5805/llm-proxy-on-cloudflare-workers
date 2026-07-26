import { SENSITIVE_CREDENTIAL_NAME_PATTERN } from "./sensitive_data";
import { AsyncLocalStorage } from "node:async_hooks";

type LogValue = string | number | boolean | null | undefined;
export type LogFields = Record<string, LogValue>;

interface RequestLogContext {
  method: string;
  path: string;
  requestPath: string;
  providers: Set<string>;
  requestId: string;
  startedAt: number;
}

const MAX_ERROR_MESSAGE_LENGTH = 500;
const LOG_MESSAGE_FIELDS: Readonly<Record<string, readonly string[]>> = {
  "request.completed": [
    "method",
    "path",
    "provider",
    "providers",
    "status",
    "duration_ms",
  ],
  "request.unhandled_error": ["error_name", "error_message"],
  "subrequest.completed": [
    "provider",
    "method",
    "url",
    "status",
    "duration_ms",
  ],
  "subrequest.failed": [
    "provider",
    "method",
    "url",
    "duration_ms",
    "error_name",
    "error_message",
  ],
  "provider.models.failed": ["provider", "error_name", "error_message"],
  "provider.models.invalid_response": ["provider"],
  "provider.models.aggregate_truncated": ["maximum_bytes"],
  "provider.connectivity.failed": ["provider", "error_name", "error_message"],
  "provider.key.selected": [
    "provider",
    "operation",
    "key_index",
    "key_count",
    "credential_configured",
    "selection_policy",
    "via_ai_gateway",
    "step",
  ],
  "provider.key.cooldown": [
    "provider",
    "key_index",
    "key_count",
    "status",
    "cooldown_seconds",
  ],
  "virtual_model.selected": [
    "virtual_model",
    "candidate",
    "attempt",
    "status",
    "timeout_ms",
  ],
  "virtual_model.retry": [
    "virtual_model",
    "candidate",
    "attempt",
    "status",
    "timeout_ms",
  ],
};
const requestLogContext = new AsyncLocalStorage<RequestLogContext>();
const scopedLogFields = new AsyncLocalStorage<LogFields>();
const SENSITIVE_QUERY_VALUE_PATTERN = new RegExp(
  `([?&](?:${SENSITIVE_CREDENTIAL_NAME_PATTERN})=)[^&#\\s]*`,
  "gi",
);
const SENSITIVE_LABELED_VALUE_PATTERN = new RegExp(
  `(\\b(?:${SENSITIVE_CREDENTIAL_NAME_PATTERN})\\b\\s*[:=]\\s*)[^\\s,&]+`,
  "gi",
);

function assignDefinedLogFields(
  target: Record<string, LogValue>,
  fields: LogFields,
): void {
  for (const fieldName of Object.keys(fields)) {
    const value = fields[fieldName];
    if (value !== undefined) {
      target[fieldName] = value;
    }
  }
}

export function redactLogText(value: string): string {
  const redacted = value
    .replace(/\bBearer\s+\S+/gi, "Bearer ***")
    .replace(SENSITIVE_QUERY_VALUE_PATTERN, "$1***")
    .replace(SENSITIVE_LABELED_VALUE_PATTERN, "$1***");

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

function summarizeLogMessage(
  event: string,
  message: string,
  fields: LogFields,
): string {
  const details: string[] = [];
  for (const fieldName of LOG_MESSAGE_FIELDS[event] ?? []) {
    const value = fields[fieldName];
    if (value !== undefined) {
      details.push(`${fieldName}=${String(value)}`);
    }
  }
  return details.length === 0 ? message : `${message}: ${details.join(", ")}`;
}

function logRecord(
  event: string,
  message: string,
  fields: LogFields,
): Record<string, LogValue> {
  const record: Record<string, LogValue> = {};
  assignDefinedLogFields(record, scopedLogFields.getStore() ?? {});
  record.event = event;
  record.request_id = requestLogContext.getStore()?.requestId ?? null;
  assignDefinedLogFields(record, fields);
  const logContext = requestLogContext.getStore();
  if (logContext && typeof record.provider === "string") {
    logContext.providers.add(record.provider);
  }
  record.message = summarizeLogMessage(event, message, record);
  return record;
}

export class RequestLogger {
  static run<T>(request: Request, callback: () => T): T {
    // Request.url is already normalized by the runtime, so extracting its path
    // by delimiters avoids another URL parser invocation on every request.
    const authorityStart = request.url.indexOf("://") + 3;
    const pathStart = request.url.indexOf("/", authorityStart);
    const requestPath = request.url.slice(pathStart);
    const queryIndex = requestPath.indexOf("?");
    const fragmentIndex = requestPath.indexOf("#");
    let pathEnd = requestPath.length;
    if (queryIndex !== -1) pathEnd = queryIndex;
    if (fragmentIndex !== -1 && fragmentIndex < pathEnd) {
      pathEnd = fragmentIndex;
    }
    const path = requestPath.slice(0, pathEnd);
    return requestLogContext.run(
      {
        method: request.method,
        path,
        requestPath,
        providers: new Set<string>(),
        requestId: request.headers.get("cf-ray") ?? crypto.randomUUID(),
        startedAt: performance.now(),
      },
      callback,
    );
  }

  static info(event: string, message: string, fields: LogFields = {}): void {
    console.info(logRecord(event, message, fields));
  }

  static withFields<T>(fields: LogFields, callback: () => T): T {
    const scopedFields: LogFields = {
      ...(scopedLogFields.getStore() ?? {}),
    };
    assignDefinedLogFields(scopedFields, fields);
    return scopedLogFields.run(scopedFields, callback);
  }

  static warn(event: string, message: string, fields: LogFields = {}): void {
    console.warn(logRecord(event, message, fields));
  }

  static error(
    event: string,
    message: string,
    error: unknown,
    fields: LogFields = {},
  ): void {
    console.error(
      logRecord(event, message, { ...fields, ...safeErrorFields(error) }),
    );
  }

  static requestFields(): LogFields {
    const logContext = requestLogContext.getStore();
    const providers = logContext?.providers;
    if (!providers || providers.size === 0) {
      return {
        method: logContext?.method,
        path: logContext?.path,
      };
    }
    const providerIterator = providers.values();
    const firstProvider = providerIterator.next().value;
    if (providers.size === 1) {
      return {
        method: logContext?.method,
        path: logContext?.path,
        provider: firstProvider,
      };
    }
    return {
      method: logContext?.method,
      path: logContext?.path,
      providers: [firstProvider, ...providerIterator].join(","),
    };
  }

  static requestPath(): string | undefined {
    return requestLogContext.getStore()?.requestPath;
  }

  static requestDurationMs(): number {
    const startedAt = requestLogContext.getStore()?.startedAt;
    return startedAt === undefined ? 0 : RequestLogger.durationMs(startedAt);
  }

  static requestId(): string | undefined {
    return requestLogContext.getStore()?.requestId;
  }

  static durationMs(startedAt: number): number {
    return Math.max(0, Math.round((performance.now() - startedAt) * 100) / 100);
  }
}
