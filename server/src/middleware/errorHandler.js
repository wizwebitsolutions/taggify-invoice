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
// logged with a request id for correlation.
export function errorHandler(err, req, res, _next) {
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({ error: { code: err.code, message: err.message } });
  }

  const requestId = randomUUID();
  console.error(`[${requestId}]`, err);
  res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "Something went wrong", requestId },
  });
}
