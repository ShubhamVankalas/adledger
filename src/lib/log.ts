// Minimal structured logger. Never pass tokens, emails or phone numbers to it.
function emit(level: "info" | "warn" | "error", msg: string, err?: unknown) {
  const line = { t: new Date().toISOString(), level, msg, ...(err ? { err: err instanceof Error ? err.message : String(err) } : {}) };
  if (process.env.NODE_ENV === "test" && level !== "error") return;
  (level === "error" ? console.error : console.log)(JSON.stringify(line));
}

export const log = {
  info: (msg: string) => emit("info", msg),
  warn: (msg: string, err?: unknown) => emit("warn", msg, err),
  error: (msg: string, err?: unknown) => emit("error", msg, err),
};
