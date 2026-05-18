import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logDir = path.join(__dirname, 'logs');
const apiErrorLog = path.join(logDir, 'api-errors.log');

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ unserializable: true });
  }
}

export function logApiError(context) {
  fs.mkdirSync(logDir, { recursive: true });

  const entry = {
    time: new Date().toISOString(),
    ...context
  };
  const line = safeJson(entry);

  fs.appendFileSync(apiErrorLog, `${line}\n`);
  console.error(`[api-error] ${entry.stage || 'unknown'} ${entry.model || ''} ${entry.status || ''} ${entry.message || ''}`.trim());
}

export function getApiErrorLogPath() {
  return apiErrorLog;
}
