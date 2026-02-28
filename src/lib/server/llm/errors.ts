export type ServerLlmErrorCode =
  | "configuration_error"
  | "timeout"
  | "request_failed"
  | "invalid_response";

export class ServerLlmError extends Error {
  constructor(
    message: string,
    readonly code: ServerLlmErrorCode,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "ServerLlmError";
  }
}
