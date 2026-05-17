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
  listPopularQuizzes,
  updateQuizEditable
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

function cleanText(value, maxLength, label) {
  const text = String(value || '').trim();
  if (!text) {
    throw new AppError(400, `${label}不能为空。`);
  }
  if (text.length > maxLength) {
    throw new AppError(400, `${label}请控制在 ${maxLength} 个字符以内。`);
  }
  return text;
}

function mergeEditableQuestions(existingQuestions, incomingQuestions) {
  if (!Array.isArray(incomingQuestions) || incomingQuestions.length !== existingQuestions.length) {
    throw new AppError(400, '题目结构不完整，请刷新后重试。');
  }

  return existingQuestions.map((question) => {
    const incoming = incomingQuestions.find((item) => item.id === question.id);
    if (!incoming) {
      throw new AppError(400, '题目结构不完整，请刷新后重试。');
    }

    if (!Array.isArray(incoming.options) || incoming.options.length !== question.options.length) {
      throw new AppError(400, '选项结构不完整，请刷新后重试。');
    }

    return {
      ...question,
      text: cleanText(incoming.text, 120, '题目文案'),
      options: question.options.map((option) => {
        const incomingOption = incoming.options.find((item) => item.id === option.id);
        if (!incomingOption) {
          throw new AppError(400, '选项结构不完整，请刷新后重试。');
        }
        return {
          ...option,
          text: cleanText(incomingOption.text, 80, '选项文案')
        };
      })
    };
  });
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

quizzesRouter.patch('/:id', asyncRoute(async (req, res) => {
  const quiz = getQuiz(req.params.id);
  if (!quiz) {
    throw new AppError(404, '没有找到这个测评。');
  }

  const title = cleanText(req.body?.title || quiz.title, 64, '测评标题');
  const intro = String(req.body?.intro || quiz.intro || '').trim().slice(0, 120);
  const questions = mergeEditableQuestions(quiz.questions, req.body?.questions);

  updateQuizEditable(quiz.id, { title, intro, questions });

  res.json({
    quiz: {
      ...quiz,
      title,
      intro,
      questions
    }
  });
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
