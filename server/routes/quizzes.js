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
const generationJobs = new Map();
const JOB_TTL_MS = 15 * 60 * 1000;

function publicQuizPayload(id, quiz) {
  return {
    id,
    title: quiz.title,
    topic: quiz.topic,
    intro: quiz.intro,
    dimensions: quiz.dimensions,
    questions: quiz.questions,
    results: quiz.results,
    generationModel: quiz.generationModel
  };
}

function pruneJobs() {
  const now = Date.now();
  for (const [id, job] of generationJobs.entries()) {
    if (now - job.updatedAt > JOB_TTL_MS && job.subscribers.size === 0) {
      generationJobs.delete(id);
    }
  }
}

function sendEvent(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function emitJob(job, event, payload) {
  job.updatedAt = Date.now();
  job.events.push({ event, payload });
  job.events = job.events.slice(-30);
  for (const subscriber of job.subscribers) {
    sendEvent(subscriber, event, payload);
  }
}

function updateJob(job, update) {
  Object.assign(job, update);
  emitJob(job, 'progress', {
    id: job.id,
    status: job.status,
    step: job.step,
    progress: job.progress,
    message: job.message,
    detail: job.detail
  });
}

function createGenerationJob(topic) {
  pruneJobs();
  const id = `g_${nanoid(8)}`;
  const job = {
    id,
    topic,
    status: 'queued',
    step: 'queued',
    progress: 0,
    message: '任务已创建',
    detail: '等待后端开始生成。',
    quiz: null,
    error: null,
    events: [],
    subscribers: new Set(),
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  generationJobs.set(id, job);
  emitJob(job, 'progress', {
    id,
    status: job.status,
    step: job.step,
    progress: job.progress,
    message: job.message,
    detail: job.detail
  });

  queueMicrotask(async () => {
    try {
      updateJob(job, {
        status: 'running',
        step: 'connect',
        progress: 5,
        message: '已连接 DeepSeek',
        detail: '后端已接收主题，准备分块生成。'
      });

      const quiz = await generateQuiz(topic, (progress) => {
        updateJob(job, {
          status: 'running',
          ...progress
        });
      });

      updateJob(job, {
        status: 'running',
        step: 'saving',
        progress: 94,
        message: '正在保存问卷',
        detail: '写入 SQLite 并生成短链接。'
      });

      const quizId = `q_${nanoid(8)}`;
      insertQuiz({
        id: quizId,
        title: quiz.title,
        topic: quiz.topic,
        intro: quiz.intro,
        dimensions: quiz.dimensions,
        questions: quiz.questions,
        results: quiz.results,
        generationModel: quiz.generationModel,
        rawAiResponse: quiz.rawAiResponse
      });

      job.status = 'done';
      job.step = 'done';
      job.progress = 100;
      job.message = '生成完成';
      job.detail = '问卷已保存，可以编辑或发布。';
      job.quiz = publicQuizPayload(quizId, quiz);
      emitJob(job, 'done', {
        id: job.id,
        status: job.status,
        step: job.step,
        progress: job.progress,
        message: job.message,
        detail: job.detail,
        quiz: job.quiz
      });
    } catch (error) {
      job.status = 'failed';
      job.step = 'failed';
      job.error = error.message || '生成失败，请重试。';
      emitJob(job, 'failed', {
        id: job.id,
        status: job.status,
        step: job.step,
        progress: job.progress,
        message: '生成失败',
        detail: job.error
      });
    }
  });

  return job;
}

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

quizzesRouter.post('/jobs', asyncRoute(async (req, res) => {
  const topic = normalizeTopic(req.body?.topic);
  const job = createGenerationJob(topic);
  res.status(202).json({
    job: {
      id: job.id,
      status: job.status,
      eventUrl: `/api/quizzes/jobs/${job.id}/events`
    }
  });
}));

quizzesRouter.get('/jobs/:jobId/events', (req, res) => {
  const job = generationJobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: '没有找到这个生成任务。' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive'
  });
  res.write('\n');

  job.subscribers.add(res);
  for (const event of job.events) {
    sendEvent(res, event.event, event.payload);
  }

  req.on('close', () => {
    job.subscribers.delete(res);
  });
});

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
      ...publicQuizPayload(id, quiz)
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
