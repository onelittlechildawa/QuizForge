import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { AppError } from './errors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, 'data');
const dbPath = path.join(dataDir, 'quizforge.db');
const D1_API_BASE = 'https://api.cloudflare.com/client/v4';

const LOCAL_SCHEMA_SQL = `
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS quizzes (
    id TEXT PRIMARY KEY,
    schema_version INTEGER NOT NULL DEFAULT 1,
    title TEXT NOT NULL,
    topic TEXT NOT NULL,
    intro TEXT,
    dimensions TEXT NOT NULL,
    questions TEXT NOT NULL,
    results TEXT NOT NULL,
    generation_model TEXT NOT NULL,
    raw_ai_response TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    play_count INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS quiz_results (
    id TEXT PRIMARY KEY,
    quiz_id TEXT NOT NULL,
    answers TEXT NOT NULL,
    scores TEXT NOT NULL,
    type_code TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_quiz_results_quiz_id ON quiz_results(quiz_id);
  CREATE INDEX IF NOT EXISTS idx_quiz_results_created_at ON quiz_results(created_at);
  CREATE INDEX IF NOT EXISTS idx_quizzes_created_at ON quizzes(created_at);
  CREATE INDEX IF NOT EXISTS idx_quizzes_play_count ON quizzes(play_count);
`;

let localDb = null;

function encode(value) {
  return JSON.stringify(value);
}

function decode(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function d1Config() {
  return {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    databaseId: process.env.CLOUDFLARE_D1_DATABASE_ID,
    apiToken: process.env.CLOUDFLARE_API_TOKEN
  };
}

function hasAnyD1Config() {
  const config = d1Config();
  return Boolean(config.accountId || config.databaseId || config.apiToken);
}

function shouldUseD1() {
  if (process.env.QUIZFORGE_DB_DRIVER === 'sqlite') {
    return false;
  }
  return process.env.QUIZFORGE_DB_DRIVER === 'd1' || process.env.VERCEL === '1' || hasAnyD1Config();
}

function requireD1Config() {
  const config = d1Config();
  const envNames = {
    accountId: 'CLOUDFLARE_ACCOUNT_ID',
    databaseId: 'CLOUDFLARE_D1_DATABASE_ID',
    apiToken: 'CLOUDFLARE_API_TOKEN'
  };
  const missing = Object.entries(config)
    .filter(([, value]) => !value)
    .map(([key]) => envNames[key]);

  if (missing.length > 0) {
    throw new AppError(500, 'Cloudflare D1 未配置完整，请在 Vercel 环境变量中设置 D1 连接信息。', {
      missing,
      required: ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_D1_DATABASE_ID', 'CLOUDFLARE_API_TOKEN']
    });
  }

  return config;
}

function getLocalDb() {
  if (!localDb) {
    fs.mkdirSync(dataDir, { recursive: true });
    localDb = new DatabaseSync(dbPath);
    localDb.exec(LOCAL_SCHEMA_SQL);
  }
  return localDb;
}

function normalizeParams(params = []) {
  return params.map((value) => (value === undefined ? null : value));
}

async function queryD1(sql, params = []) {
  const { accountId, databaseId, apiToken } = requireD1Config();
  const response = await fetch(`${D1_API_BASE}/accounts/${accountId}/d1/database/${databaseId}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      sql,
      params: normalizeParams(params)
    })
  });

  const payload = await response.json().catch(() => null);
  const firstResult = payload?.result?.[0];

  if (!response.ok || !payload?.success || !firstResult?.success) {
    throw new AppError(502, 'Cloudflare D1 查询失败，请检查数据库配置或稍后重试。', {
      status: response.status,
      errors: payload?.errors || null,
      messages: payload?.messages || null,
      sql: sql.slice(0, 160)
    });
  }

  return firstResult;
}

async function run(sql, params = []) {
  if (shouldUseD1()) {
    await queryD1(sql, params);
    return;
  }
  getLocalDb().prepare(sql).run(...normalizeParams(params));
}

async function get(sql, params = []) {
  if (shouldUseD1()) {
    const result = await queryD1(sql, params);
    return result.results?.[0] || null;
  }
  return getLocalDb().prepare(sql).get(...normalizeParams(params));
}

async function all(sql, params = []) {
  if (shouldUseD1()) {
    const result = await queryD1(sql, params);
    return result.results || [];
  }
  return getLocalDb().prepare(sql).all(...normalizeParams(params));
}

function quizFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    schemaVersion: row.schema_version,
    title: row.title,
    topic: row.topic,
    intro: row.intro || '',
    dimensions: decode(row.dimensions, []),
    questions: decode(row.questions, []),
    results: decode(row.results, []),
    generationModel: row.generation_model,
    createdAt: row.created_at,
    playCount: row.play_count
  };
}

export async function insertQuiz({ id, title, topic, intro, dimensions, questions, results, generationModel, rawAiResponse }) {
  await run(`
    INSERT INTO quizzes (
      id, schema_version, title, topic, intro, dimensions, questions, results, generation_model, raw_ai_response
    )
    VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id,
    title,
    topic,
    intro || '',
    encode(dimensions),
    encode(questions),
    encode(results),
    generationModel,
    rawAiResponse || null
  ]);
}

export async function getQuiz(id) {
  return quizFromRow(await get('SELECT * FROM quizzes WHERE id = ?', [id]));
}

export async function updateQuizEditable(id, { title, intro, questions }) {
  await run(`
    UPDATE quizzes
    SET title = ?, intro = ?, questions = ?
    WHERE id = ?
  `, [title, intro || '', encode(questions), id]);
}

export async function listPopularQuizzes(limit = 8) {
  const rows = await all(`
    SELECT id, title, topic, intro, created_at, play_count
    FROM quizzes
    ORDER BY play_count DESC, created_at DESC
    LIMIT ?
  `, [limit]);

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    topic: row.topic,
    intro: row.intro || '',
    createdAt: row.created_at,
    playCount: row.play_count
  }));
}

export async function incrementPlayCount(quizId) {
  await run('UPDATE quizzes SET play_count = play_count + 1 WHERE id = ?', [quizId]);
}

export async function insertResult({ id, quizId, answers, scores, typeCode }) {
  await run(`
    INSERT INTO quiz_results (id, quiz_id, answers, scores, type_code)
    VALUES (?, ?, ?, ?, ?)
  `, [id, quizId, encode(answers), encode(scores), typeCode]);
}

export async function getResult(resultId) {
  const row = await get(`
    SELECT
      r.id,
      r.quiz_id,
      r.answers,
      r.scores,
      r.type_code,
      r.created_at,
      q.title,
      q.topic,
      q.intro,
      q.dimensions,
      q.questions,
      q.results,
      q.generation_model
    FROM quiz_results r
    JOIN quizzes q ON q.id = r.quiz_id
    WHERE r.id = ?
  `, [resultId]);

  if (!row) return null;

  const quizResults = decode(row.results, []);
  const selectedResult = quizResults.find((item) => item.typeCode === row.type_code) || null;

  return {
    id: row.id,
    quizId: row.quiz_id,
    typeCode: row.type_code,
    answers: decode(row.answers, []),
    scores: decode(row.scores, {}),
    createdAt: row.created_at,
    result: selectedResult,
    quiz: {
      id: row.quiz_id,
      title: row.title,
      topic: row.topic,
      intro: row.intro || '',
      dimensions: decode(row.dimensions, []),
      questions: decode(row.questions, []),
      results: quizResults,
      generationModel: row.generation_model
    }
  };
}

export async function getQuizStats(quizId) {
  const totalRow = await get('SELECT COUNT(*) AS total FROM quiz_results WHERE quiz_id = ?', [quizId]);
  const distribution = await all(`
    SELECT type_code AS typeCode, COUNT(*) AS count
    FROM quiz_results
    WHERE quiz_id = ?
    GROUP BY type_code
    ORDER BY count DESC, type_code ASC
  `, [quizId]);

  const total = totalRow?.total || 0;
  return {
    total,
    distribution: distribution.map((row) => ({
      typeCode: row.typeCode,
      count: row.count,
      percentage: total ? Math.round((row.count / total) * 100) : 0
    }))
  };
}
