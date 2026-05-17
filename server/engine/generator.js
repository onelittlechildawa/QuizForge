import { generateQuizWithDeepSeek } from './ai-adapter.js';
import { AppError } from '../errors.js';

const REQUIRED_TYPE_CODES = [
  'ESFJ', 'ESFP', 'ESTJ', 'ESTP',
  'ENFJ', 'ENFP', 'ENTJ', 'ENTP',
  'ISFJ', 'ISFP', 'ISTJ', 'ISTP',
  'INFJ', 'INFP', 'INTJ', 'INTP'
];

const DIMENSION_CODES = [
  ['E', 'I'],
  ['S', 'N'],
  ['F', 'T'],
  ['J', 'P']
];

function cleanText(value, fallback = '') {
  return String(value || fallback).trim();
}

function ensureArray(value, label) {
  if (!Array.isArray(value)) {
    throw new AppError(502, `DeepSeek 返回的 ${label} 不是数组，请重试。`);
  }
  return value;
}

function normalizeDimensions(dimensions) {
  const items = ensureArray(dimensions, 'dimensions');
  if (items.length !== 4) {
    throw new AppError(502, 'DeepSeek 返回的维度数量不是 4 个，请重试。');
  }

  return items.map((dimension, index) => {
    const [positiveCode, negativeCode] = DIMENSION_CODES[index];
    return {
      id: `d${index + 1}`,
      name: cleanText(dimension.name, `维度 ${index + 1}`),
      positiveCode,
      positiveLabel: cleanText(dimension.positiveLabel, positiveCode),
      negativeCode,
      negativeLabel: cleanText(dimension.negativeLabel, negativeCode),
      description: cleanText(dimension.description, '')
    };
  });
}

function normalizeQuestions(questions, dimensions) {
  const items = ensureArray(questions, 'questions');
  if (items.length !== 12) {
    throw new AppError(502, 'DeepSeek 返回的题目数量不是 12 道，请重试。');
  }

  const dimensionIds = new Set(dimensions.map((dimension) => dimension.id));
  const counts = Object.fromEntries(dimensions.map((dimension) => [dimension.id, 0]));

  const normalized = items.map((question, index) => {
    const dimensionId = cleanText(question.dimensionId);
    if (!dimensionIds.has(dimensionId)) {
      throw new AppError(502, `题目 ${index + 1} 绑定了未知维度，请重试。`);
    }

    const options = ensureArray(question.options, `questions[${index}].options`);
    if (options.length < 2 || options.length > 4) {
      throw new AppError(502, `题目 ${index + 1} 的选项数量不在 2 到 4 个之间，请重试。`);
    }

    counts[dimensionId] += 1;

    return {
      id: `q${index + 1}`,
      dimensionId,
      text: cleanText(question.text, `第 ${index + 1} 题`),
      options: options.map((option, optionIndex) => {
        const score = Number(option.score);
        if (![1, -1].includes(score)) {
          throw new AppError(502, `题目 ${index + 1} 的选项分值不是 1 或 -1，请重试。`);
        }
        return {
          id: String.fromCharCode(97 + optionIndex),
          text: cleanText(option.text, `选项 ${optionIndex + 1}`),
          score
        };
      })
    };
  });

  const invalidDimension = Object.entries(counts).find(([, count]) => count !== 3);
  if (invalidDimension) {
    throw new AppError(502, 'DeepSeek 返回的题目没有做到每个维度 3 道，请重试。');
  }

  return normalized;
}

function normalizeResults(results) {
  const items = ensureArray(results, 'results');
  const byCode = new Map();

  for (const item of items) {
    const typeCode = cleanText(item.typeCode).toUpperCase();
    if (REQUIRED_TYPE_CODES.includes(typeCode)) {
      byCode.set(typeCode, {
        typeCode,
        name: cleanText(item.name, typeCode),
        emoji: cleanText(item.emoji, '✨'),
        summary: cleanText(item.summary, ''),
        strengths: ensureArray(item.strengths || [], `results.${typeCode}.strengths`).slice(0, 4).map((text) => cleanText(text)).filter(Boolean),
        suggestions: ensureArray(item.suggestions || [], `results.${typeCode}.suggestions`).slice(0, 3).map((text) => cleanText(text)).filter(Boolean)
      });
    }
  }

  const missing = REQUIRED_TYPE_CODES.filter((typeCode) => !byCode.has(typeCode));
  if (missing.length > 0) {
    throw new AppError(502, `DeepSeek 返回的结果类型缺少 ${missing.join('、')}，请重试。`);
  }

  return REQUIRED_TYPE_CODES.map((typeCode) => byCode.get(typeCode));
}

function normalizeQuiz(topic, quiz) {
  const dimensions = normalizeDimensions(quiz.dimensions);
  const questions = normalizeQuestions(quiz.questions, dimensions);
  const results = normalizeResults(quiz.results);

  return {
    title: cleanText(quiz.title, `${topic}测评`),
    topic,
    intro: cleanText(quiz.intro, '用 12 道题看看你更接近哪一种类型。'),
    dimensions,
    questions,
    results
  };
}

export async function generateQuiz(topic) {
  const generated = await generateQuizWithDeepSeek(topic);
  return {
    ...normalizeQuiz(topic, generated.quiz),
    generationModel: generated.model,
    rawAiResponse: generated.raw
  };
}
