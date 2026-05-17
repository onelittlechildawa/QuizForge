import { AppError } from '../errors.js';

function normalizeAnswers(input) {
  if (Array.isArray(input)) {
    return input.map((answer) => ({
      questionId: String(answer.questionId || ''),
      optionId: String(answer.optionId || '')
    }));
  }

  if (input && typeof input === 'object') {
    return Object.entries(input).map(([questionId, optionId]) => ({
      questionId,
      optionId: String(optionId)
    }));
  }

  throw new AppError(400, '答案格式不正确。');
}

export function scoreQuiz(quiz, answerInput) {
  const answers = normalizeAnswers(answerInput);
  const answerMap = new Map(answers.map((answer) => [answer.questionId, answer.optionId]));
  const rawScores = Object.fromEntries(quiz.dimensions.map((dimension) => [dimension.id, 0]));
  const maxScores = Object.fromEntries(quiz.dimensions.map((dimension) => [dimension.id, 0]));

  for (const question of quiz.questions) {
    const optionId = answerMap.get(question.id);
    if (!optionId) {
      throw new AppError(400, '请完成所有题目后再提交。');
    }

    const option = question.options.find((item) => item.id === optionId);
    if (!option) {
      throw new AppError(400, '答案包含无效选项，请刷新后重试。');
    }

    rawScores[question.dimensionId] += Number(option.score);
    maxScores[question.dimensionId] += 1;
  }

  const dimensionScores = quiz.dimensions.map((dimension) => {
    const raw = rawScores[dimension.id] || 0;
    const max = maxScores[dimension.id] || 1;
    const selectedPositive = raw >= 0;
    const selectedCode = selectedPositive ? dimension.positiveCode : dimension.negativeCode;
    const selectedLabel = selectedPositive ? dimension.positiveLabel : dimension.negativeLabel;
    const opposingCode = selectedPositive ? dimension.negativeCode : dimension.positiveCode;
    const opposingLabel = selectedPositive ? dimension.negativeLabel : dimension.positiveLabel;
    const intensity = Math.round(50 + (Math.abs(raw) / max) * 50);

    return {
      id: dimension.id,
      name: dimension.name,
      description: dimension.description,
      raw,
      max,
      selectedCode,
      selectedLabel,
      opposingCode,
      opposingLabel,
      selectedPercentage: intensity,
      opposingPercentage: 100 - intensity
    };
  });

  const typeCode = dimensionScores.map((score) => score.selectedCode).join('');
  const matchedResult = quiz.results.find((result) => result.typeCode === typeCode);

  if (!matchedResult) {
    throw new AppError(500, '没有找到匹配的结果类型。');
  }

  return {
    typeCode,
    dimensions: dimensionScores,
    rawScores
  };
}
