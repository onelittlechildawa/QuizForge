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
const HEARTBEAT_INTERVAL_MS = 15000;

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

function sendEvent(res, event, payload) {
  if (res.writableEnded || res.destroyed) return;
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function sendProgress(res, jobId, update) {
  const payload = {
    id: jobId,
    status: 'running',
    step: update.step,
    progress: update.progress,
    message: update.message,
    detail: update.detail
  };
  if (Object.prototype.hasOwnProperty.call(update, 'preview')) {
    payload.preview = update.preview;
  }
  sendEvent(res, 'progress', payload);
}

function writeSseHeaders(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write('\n');
  res.flushHeaders?.();
}

async function streamGenerationJob(topic, res, jobId) {
  sendEvent(res, 'progress', {
    id: jobId,
    status: 'queued',
    step: 'queued',
    progress: 0,
    message: '任务已创建',
    detail: '等待后端开始生成。'
  });

  sendProgress(res, jobId, {
    step: 'connect',
    progress: 5,
    message: '已连接 DeepSeek',
    detail: '后端已接收主题，准备分块生成。'
  });

  const quiz = await generateQuiz(topic, (progress) => {
    sendProgress(res, jobId, progress);
  });

  sendProgress(res, jobId, {
    step: 'saving',
    progress: 94,
    message: '正在保存问卷',
    detail: '写入数据库并生成短链接。'
  });

  const quizId = `q_${nanoid(8)}`;
  await insertQuiz({
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

  sendEvent(res, 'done', {
    id: jobId,
    status: 'done',
    step: 'done',
    progress: 100,
    message: '生成完成',
    detail: '问卷已保存，可以编辑或发布。',
    quiz: publicQuizPayload(quizId, quiz)
  });
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
  const requestedLimit = Number(req.query.limit || 8);
  const limit = Number.isFinite(requestedLimit) ? Math.min(requestedLimit, 20) : 8;
  res.json({ quizzes: await listPopularQuizzes(limit) });
}));

quizzesRouter.post('/jobs', asyncRoute(async (req, res) => {
  const topic = normalizeTopic(req.body?.topic);
  const jobId = `g_${nanoid(8)}`;
  let responseClosed = false;

  res.on('close', () => {
    responseClosed = true;
  });

  writeSseHeaders(res);
  const heartbeat = setInterval(() => {
    if (!responseClosed && !res.writableEnded && !res.destroyed) {
      res.write(': heartbeat\n\n');
    }
  }, HEARTBEAT_INTERVAL_MS);

  try {
    await streamGenerationJob(topic, res, jobId);
  } catch (error) {
    sendEvent(res, 'failed', {
      id: jobId,
      status: 'failed',
      step: 'failed',
      progress: 0,
      message: '生成失败',
      detail: error.message || '生成失败，请重试。'
    });
  } finally {
    clearInterval(heartbeat);
    if (!responseClosed && !res.writableEnded && !res.destroyed) {
      res.end();
    }
  }
}));

quizzesRouter.post('/', asyncRoute(async (req, res) => {
  const topic = normalizeTopic(req.body?.topic);
  const quiz = await generateQuiz(topic);
  const id = `q_${nanoid(8)}`;

  await insertQuiz({
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
  const quiz = await getQuiz(req.params.id);
  if (!quiz) {
    throw new AppError(404, '没有找到这个测评。');
  }
  res.json({ quiz });
}));

quizzesRouter.patch('/:id', asyncRoute(async (req, res) => {
  const quiz = await getQuiz(req.params.id);
  if (!quiz) {
    throw new AppError(404, '没有找到这个测评。');
  }

  const title = cleanText(req.body?.title || quiz.title, 64, '测评标题');
  const intro = String(req.body?.intro || quiz.intro || '').trim().slice(0, 120);
  const questions = mergeEditableQuestions(quiz.questions, req.body?.questions);

  await updateQuizEditable(quiz.id, { title, intro, questions });

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
  const quiz = await getQuiz(req.params.id);
  if (!quiz) {
    throw new AppError(404, '没有找到这个测评。');
  }

  const scored = scoreQuiz(quiz, req.body?.answers);
  const resultId = `r_${nanoid(8)}`;

  await insertResult({
    id: resultId,
    quizId: quiz.id,
    answers: req.body.answers,
    scores: scored,
    typeCode: scored.typeCode
  });
  await incrementPlayCount(quiz.id);

  res.status(201).json({
    resultId,
    typeCode: scored.typeCode,
    scores: scored
  });
}));

quizzesRouter.get('/:id/stats', asyncRoute(async (req, res) => {
  const quiz = await getQuiz(req.params.id);
  if (!quiz) {
    throw new AppError(404, '没有找到这个测评。');
  }
  res.json({ stats: await getQuizStats(quiz.id) });
}));
