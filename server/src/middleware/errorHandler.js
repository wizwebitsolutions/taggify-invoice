import { randomUUID } from "node:crypto";

export class ApiError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: "NOT_FOUND", message: `No route for ${req.method} ${req.path}` } });
}

// Centralized error handler — consistent { error: { code, message } } shape,
// 4xx (validation/permission/known) vs 5xx (unexpected) distinguished, 5xx
// logged with a request id for correlation. Every error's code and message also
// lands on the request's log line (middleware/requestLog.js reads the body); a
// 500's real message, hidden from the client, is put there via res.locals.error.
export function errorHandler(err, req, res, _next) {
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({ error: { code: err.code, message: err.message } });
  }

  // Same id as the request's log line and its X-Request-Id header, when requestLog ran.
  const requestId = req.id ?? randomUUID();
  res.locals.error = { code: "INTERNAL_ERROR", message: err?.message };
  console.error(`[req=${requestId.slice(0, 8)}] ${req.method} ${req.originalUrl?.split("?")[0]}`, err);
  res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "Something went wrong", requestId },
  });
}
