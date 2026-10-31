export interface Logger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

function write(level: string, message: string, data?: Record<string, unknown>): void {
  const line = JSON.stringify({ level, time: new Date().toISOString(), message, ...data });
  (level === 'info' ? process.stdout : process.stderr).write(`${line}\n`);
}

/** JSON lines on stdout/stderr. Callers must never pass secrets or connection URLs. */
export const consoleLog: Logger = {
  info: (m, d) => write('info', m, d),
  warn: (m, d) => write('warn', m, d),
  error: (m, d) => write('error', m, d),
};
