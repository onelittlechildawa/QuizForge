import express from 'express';
import { nanoid } from 'nanoid';
import { asyncRoute, AppError } from '../errors.js';
import { generateQuiz } from '../engine/generator.js';
import { scoreQuiz } from '../engine/scorer.js';
import {
  getQuiz,
  getQuizStats,
  incrementPlayCount,
  insertQuiz,
  insertResult,
  listPopularQuizzes
} from '../db.js';

export const quizzesRouter = express.Router();

function normalizeTopic(topic) {
  const value = String(topic || '').trim();
  if (value.length < 2) {
    throw new AppError(400, '请输入至少 2 个字符的测评主题。');
  }
  if (value.length > 48) {
    throw new AppError(400, '测评主题请控制在 48 个字符以内。');
  }
  return value;
}

quizzesRouter.get('/popular', asyncRoute(async (req, res) => {
  const limit = Math.min(Number(req.query.limit || 8), 20);
  res.json({ quizzes: listPopularQuizzes(limit) });
}));

quizzesRouter.post('/', asyncRoute(async (req, res) => {
  const topic = normalizeTopic(req.body?.topic);
  const quiz = await generateQuiz(topic);
  const id = `q_${nanoid(8)}`;

  insertQuiz({
    id,
    title: quiz.title,
    topic: quiz.topic,
    intro: quiz.intro,
    dimensions: quiz.dimensions,
    questions: quiz.questions,
    results: quiz.results,
    generationModel: quiz.generationModel,
    rawAiResponse: quiz.rawAiResponse
  });

  res.status(201).json({
    quiz: {
      id,
      title: quiz.title,
      topic: quiz.topic,
      intro: quiz.intro,
      dimensions: quiz.dimensions,
      questions: quiz.questions,
      results: quiz.results,
      generationModel: quiz.generationModel
    }
  });
}));

quizzesRouter.get('/:id', asyncRoute(async (req, res) => {
  const quiz = getQuiz(req.params.id);
  if (!quiz) {
    throw new AppError(404, '没有找到这个测评。');
  }
  res.json({ quiz });
}));

quizzesRouter.post('/:id/submit', asyncRoute(async (req, res) => {
  const quiz = getQuiz(req.params.id);
  if (!quiz) {
    throw new AppError(404, '没有找到这个测评。');
  }

  const scored = scoreQuiz(quiz, req.body?.answers);
  const resultId = `r_${nanoid(8)}`;

  insertResult({
    id: resultId,
    quizId: quiz.id,
    answers: req.body.answers,
    scores: scored,
    typeCode: scored.typeCode
  });
  incrementPlayCount(quiz.id);

  res.status(201).json({
    resultId,
    typeCode: scored.typeCode,
    scores: scored
  });
}));

quizzesRouter.get('/:id/stats', asyncRoute(async (req, res) => {
  const quiz = getQuiz(req.params.id);
  if (!quiz) {
    throw new AppError(404, '没有找到这个测评。');
  }
  res.json({ stats: getQuizStats(quiz.id) });
}));
