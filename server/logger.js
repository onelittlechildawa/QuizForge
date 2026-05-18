import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logDir = path.join(__dirname, 'logs');
const apiErrorLog = path.join(logDir, 'api-errors.log');

function shouldWriteFileLog() {
  return process.env.NODE_ENV !== 'production' && !process.env.VERCEL;
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ unserializable: true });
  }
}

export function logApiError(context) {
  const entry = {
    time: new Date().toISOString(),
    ...context
  };
  const line = safeJson(entry);

  if (shouldWriteFileLog()) {
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(apiErrorLog, `${line}\n`);
  }

  const attempt = entry.attempt && entry.maxAttempts ? `attempt=${entry.attempt}/${entry.maxAttempts}` : '';
  const retry = entry.willRetry ? 'retrying' : '';
  const summary = `[api-error] ${entry.stage || 'unknown'} ${entry.model || ''} ${entry.status || ''} ${attempt} ${retry} ${entry.message || ''}`.trim();
  console.error(`${summary} ${line}`);
}

export function getApiErrorLogPath() {
  if (!shouldWriteFileLog()) {
    return 'stderr';
  }
  return apiErrorLog;
}
