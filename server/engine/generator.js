import { generateQuizPlanWithDeepSeek, generateQuestionsWithDeepSeek, generateResultsWithDeepSeek } from './ai-adapter.js';
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

function normalizeQuestionList(questions, dimensions, { expectedCount, startIndex = 0, dimensionId = null, enforceAllDimensions = false } = {}) {
  const items = ensureArray(questions, 'questions');
  if (items.length !== expectedCount) {
    throw new AppError(502, `DeepSeek 返回的题目数量不是 ${expectedCount} 道，请重试。`);
  }

  const dimensionIds = new Set(dimensions.map((dimension) => dimension.id));
  const counts = Object.fromEntries(dimensions.map((dimension) => [dimension.id, 0]));

  const normalized = items.map((question, index) => {
    const resolvedDimensionId = dimensionId || cleanText(question.dimensionId);
    if (!dimensionIds.has(resolvedDimensionId)) {
      throw new AppError(502, `题目 ${index + 1} 绑定了未知维度，请重试。`);
    }

    const options = ensureArray(question.options, `questions[${index}].options`);
    if (options.length !== 5) {
      throw new AppError(502, `题目 ${index + 1} 的选项数量不是 5 个，请重试。`);
    }

    const scores = new Set(options.map((option) => Number(option.score)));
    for (const requiredScore of [-2, -1, 0, 1, 2]) {
      if (!scores.has(requiredScore)) {
        throw new AppError(502, `题目 ${index + 1} 没有覆盖完整五档分值，请重试。`);
      }
    }

    counts[resolvedDimensionId] += 1;

    return {
      id: `q${startIndex + index + 1}`,
      dimensionId: resolvedDimensionId,
      text: cleanText(question.text, `第 ${index + 1} 题`),
      options: options.map((option, optionIndex) => {
        const score = Number(option.score);
        if (![-2, -1, 0, 1, 2].includes(score)) {
          throw new AppError(502, `题目 ${index + 1} 的选项分值不是 -2 到 2，请重试。`);
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
  if (enforceAllDimensions && invalidDimension) {
    throw new AppError(502, 'DeepSeek 返回的题目没有做到每个维度 3 道，请重试。');
  }

  return normalized;
}

function normalizeQuestions(questions, dimensions) {
  return normalizeQuestionList(questions, dimensions, { expectedCount: 12, enforceAllDimensions: true });
}

function normalizeQuestionBatch(questions, dimensions, dimension, startIndex) {
  const normalized = normalizeQuestionList(questions, dimensions, {
    expectedCount: 3,
    startIndex,
    dimensionId: dimension.id
  });
  if (normalized.some((question) => question.dimensionId !== dimension.id)) {
    throw new AppError(502, `${dimension.name} 维度题目绑定错误，请重试。`);
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

function normalizeResultBatch(results, expectedTypeCodes) {
  const items = ensureArray(results, 'results');
  const expected = new Set(expectedTypeCodes);
  const byCode = new Map();

  for (const item of items) {
    const typeCode = cleanText(item.typeCode).toUpperCase();
    if (expected.has(typeCode)) {
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

  const missing = expectedTypeCodes.filter((typeCode) => !byCode.has(typeCode));
  if (missing.length > 0) {
    throw new AppError(502, `DeepSeek 返回的结果解析缺少 ${missing.join('、')}，请重试。`);
  }

  return expectedTypeCodes.map((typeCode) => byCode.get(typeCode));
}

function findDimensionByCode(dimensions, code) {
  return dimensions.find((dimension) => dimension.positiveCode === code || dimension.negativeCode === code);
}

function labelForCode(dimension, code) {
  return dimension?.positiveCode === code ? dimension.positiveLabel : dimension?.negativeLabel;
}

function generateFallbackResults(topic, dimensions, resultTone = {}) {
  const emoji = cleanText(resultTone.emoji, '✨');
  const styleWords = Array.isArray(resultTone.styleWords)
    ? resultTone.styleWords.map((word) => cleanText(word)).filter(Boolean).slice(0, 3)
    : [];

  return REQUIRED_TYPE_CODES.map((typeCode) => {
    const labels = typeCode.split('').map((code) => {
      const dimension = findDimensionByCode(dimensions, code);
      return labelForCode(dimension, code) || code;
    });
    const [energy, perception, judgment, rhythm] = labels;
    const name = `${energy}${perception}型`;
    const tone = styleWords.length ? `带着${styleWords.join('、')}的气质，` : '';

    return {
      typeCode,
      name,
      emoji,
      summary: `${tone}你在「${topic}」里更像${energy}、${perception}、${judgment}、${rhythm}的组合。`,
      strengths: [
        `擅长发挥${energy}的一面`,
        `看待问题带有${perception}倾向`,
        `做选择时常体现${judgment}风格`
      ],
      suggestions: [
        `偶尔给${rhythm}之外的节奏留一点空间`,
        '把这个结果当作轻松参考，不必给自己贴死标签'
      ]
    };
  });
}

function normalizeQuiz(topic, quiz) {
  const dimensions = normalizeDimensions(quiz.dimensions);
  const questions = normalizeQuestions(quiz.questions, dimensions);
  const results = Array.isArray(quiz.results)
    ? normalizeResults(quiz.results)
    : generateFallbackResults(topic, dimensions, quiz.resultTone);

  return {
    title: cleanText(quiz.title, `${topic}测评`),
    topic,
    intro: cleanText(quiz.intro, '用 12 道题看看你更接近哪一种类型。'),
    dimensions,
    questions,
    results
  };
}

export async function generateQuiz(topic, onProgress = () => {}) {
  onProgress({
    step: 'plan',
    progress: 12,
    message: '正在生成测评设定',
    detail: 'DeepSeek 正在设计标题、简介和 4 个维度。'
  });
  const generatedPlan = await generateQuizPlanWithDeepSeek(topic);
  const plan = generatedPlan.data;
  const dimensions = normalizeDimensions(plan.dimensions);
  const questions = [];
  const results = [];
  const rawQuestionBatches = [];
  const rawResultBatches = [];

  onProgress({
    step: 'dimensions',
    progress: 28,
    message: '维度已生成',
    detail: `已生成 ${dimensions.length} 个类人格维度。`
  });

  for (const [index, dimension] of dimensions.entries()) {
    onProgress({
      step: `questions-${dimension.id}`,
      progress: 32 + index * 13,
      message: `正在生成「${dimension.name}」题目`,
      detail: `DeepSeek 正在生成 ${dimension.positiveLabel} / ${dimension.negativeLabel} 的 5 档题目。`
    });
    const generatedQuestions = await generateQuestionsWithDeepSeek(topic, dimension);
    rawQuestionBatches.push(generatedQuestions.raw);
    questions.push(...normalizeQuestionBatch(generatedQuestions.data.questions, dimensions, dimension, questions.length));
    onProgress({
      step: `questions-${dimension.id}-done`,
      progress: 45 + index * 13,
      message: `「${dimension.name}」题目已完成`,
      detail: `已生成 ${questions.length}/12 道题。`
    });
  }

  onProgress({
    step: 'results',
    progress: 84,
    message: '正在生成结果解析',
    detail: 'DeepSeek 正在分批生成 16 种结果报告。'
  });

  const resultBatches = [
    REQUIRED_TYPE_CODES.slice(0, 4),
    REQUIRED_TYPE_CODES.slice(4, 8),
    REQUIRED_TYPE_CODES.slice(8, 12),
    REQUIRED_TYPE_CODES.slice(12, 16)
  ];

  for (const [index, typeCodes] of resultBatches.entries()) {
    onProgress({
      step: `results-${index + 1}`,
      progress: 84 + index * 3,
      message: `正在生成第 ${index + 1} 组结果解析`,
      detail: `DeepSeek 正在撰写 ${typeCodes.join('、')} 的结果报告。`
    });
    const generatedResults = await generateResultsWithDeepSeek(topic, dimensions, typeCodes, plan.resultTone);
    rawResultBatches.push(generatedResults.raw);
    results.push(...normalizeResultBatch(generatedResults.data.results, typeCodes));
    onProgress({
      step: `results-${index + 1}-done`,
      progress: 87 + index * 3,
      message: `第 ${index + 1} 组结果解析已完成`,
      detail: `已生成 ${results.length}/16 个结果报告。`
    });
  }

  return {
    title: cleanText(plan.title, `${topic}测评`),
    topic,
    intro: cleanText(plan.intro, '用 12 道题看看你更接近哪一种类型。'),
    dimensions,
    questions,
    results: normalizeResults(results),
    generationModel: generatedPlan.model,
    rawAiResponse: JSON.stringify({
      plan: generatedPlan.raw,
      questionBatches: rawQuestionBatches,
      resultBatches: rawResultBatches
    })
  };
}
