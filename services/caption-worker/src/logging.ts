export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

export type Logger = {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
};

function normalizeFields(fields: LogFields | undefined): LogFields {
  if (!fields) {
    return {};
  }

  const normalized: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value instanceof Error) {
      normalized[key] = {
        name: value.name,
        message: value.message,
        stack: value.stack,
      };
      continue;
    }
    normalized[key] = value;
  }

  return normalized;
}

function write(level: LogLevel, message: string, fields?: LogFields) {
  const payload = {
    severity: level.toUpperCase(),
    message,
    time: new Date().toISOString(),
    ...normalizeFields(fields),
  };

  const line = JSON.stringify(payload);
  switch (level) {
    case "debug":
    case "info":
      console.log(line);
      break;
    case "warn":
      console.warn(line);
      break;
    case "error":
      console.error(line);
      break;
  }
}

export function createLogger(): Logger {
  return {
    debug(message, fields) {
      write("debug", message, fields);
    },
    info(message, fields) {
      write("info", message, fields);
    },
    warn(message, fields) {
      write("warn", message, fields);
    },
    error(message, fields) {
      write("error", message, fields);
    },
  };
}
