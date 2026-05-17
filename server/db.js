import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, 'data');
const dbPath = path.join(dataDir, 'quizforge.db');

fs.mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(dbPath);

db.exec(`
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
`);

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

export function insertQuiz({ id, title, topic, intro, dimensions, questions, results, generationModel, rawAiResponse }) {
  db.prepare(`
    INSERT INTO quizzes (
      id, schema_version, title, topic, intro, dimensions, questions, results, generation_model, raw_ai_response
    )
    VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    title,
    topic,
    intro || '',
    encode(dimensions),
    encode(questions),
    encode(results),
    generationModel,
    rawAiResponse || null
  );
}

export function getQuiz(id) {
  return quizFromRow(db.prepare('SELECT * FROM quizzes WHERE id = ?').get(id));
}

export function listPopularQuizzes(limit = 8) {
  return db.prepare(`
    SELECT id, title, topic, intro, created_at, play_count
    FROM quizzes
    ORDER BY play_count DESC, created_at DESC
    LIMIT ?
  `).all(limit).map((row) => ({
    id: row.id,
    title: row.title,
    topic: row.topic,
    intro: row.intro || '',
    createdAt: row.created_at,
    playCount: row.play_count
  }));
}

export function incrementPlayCount(quizId) {
  db.prepare('UPDATE quizzes SET play_count = play_count + 1 WHERE id = ?').run(quizId);
}

export function insertResult({ id, quizId, answers, scores, typeCode }) {
  db.prepare(`
    INSERT INTO quiz_results (id, quiz_id, answers, scores, type_code)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, quizId, encode(answers), encode(scores), typeCode);
}

export function getResult(resultId) {
  const row = db.prepare(`
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
  `).get(resultId);

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

export function getQuizStats(quizId) {
  const totalRow = db.prepare('SELECT COUNT(*) AS total FROM quiz_results WHERE quiz_id = ?').get(quizId);
  const distribution = db.prepare(`
    SELECT type_code AS typeCode, COUNT(*) AS count
    FROM quiz_results
    WHERE quiz_id = ?
    GROUP BY type_code
    ORDER BY count DESC, type_code ASC
  `).all(quizId);

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
