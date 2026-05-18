PRAGMA foreign_keys = ON;

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
