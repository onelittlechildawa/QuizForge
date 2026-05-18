import { AppError } from '../errors.js';
import { logApiError } from '../logger.js';

const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-v4-flash';
const REQUEST_TIMEOUT_MS = 60000;
const DEFAULT_MAX_RETRIES = 2;

function resolveEndpoint() {
  if (process.env.DEEPSEEK_ENDPOINT) {
    return process.env.DEEPSEEK_ENDPOINT;
  }

  const baseUrl = process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE_URL;
  return `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
}

function shouldDisableThinking(model) {
  if (process.env.DEEPSEEK_DISABLE_THINKING) {
    return process.env.DEEPSEEK_DISABLE_THINKING === 'true';
  }
  return model.includes('v4-pro') || model.includes('reasoner');
}

function resolveTimeoutMs() {
  const configured = Number(process.env.DEEPSEEK_TIMEOUT_MS || REQUEST_TIMEOUT_MS);
  if (!Number.isFinite(configured) || configured <= 0) {
    return REQUEST_TIMEOUT_MS;
  }
  return Math.min(configured, REQUEST_TIMEOUT_MS);
}

function resolveMaxRetries() {
  const configured = Number(process.env.DEEPSEEK_MAX_RETRIES);
  if (!Number.isFinite(configured) || configured < 0) {
    return DEFAULT_MAX_RETRIES;
  }
  return Math.min(Math.floor(configured), 5);
}

function retryDelayMs(attempt) {
  return Math.min(800 * (2 ** (attempt - 1)), 3200) + Math.floor(Math.random() * 250);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function markRetryable(error, retryable) {
  error.retryable = retryable;
  return error;
}

export function buildPlanPrompt(topic) {
  return `
请为主题「${topic}」生成一个结构化娱乐测评问卷的基础设定。它用于社交分享和自我表达，不是心理诊断。

必须只返回一个合法 JSON object，不要 Markdown，不要解释。JSON schema 如下：
{
  "title": "问卷标题",
  "topic": "原始主题",
  "intro": "一句轻松的问卷介绍，30 字以内",
  "dimensions": [
    {
      "id": "d1",
      "name": "维度名",
      "positiveCode": "E",
      "positiveLabel": "正向标签",
      "negativeCode": "I",
      "negativeLabel": "反向标签",
      "description": "这个维度衡量什么，30 字以内"
    }
  ],
  "resultTone": {
    "emoji": "一个和主题相关的 emoji",
    "styleWords": ["用于结果文案的关键词 1", "关键词 2", "关键词 3"]
  }
}

硬性要求：
1. dimensions 必须正好 4 个，id 必须依次为 d1、d2、d3、d4。
2. 4 个维度代码必须分别是：d1 使用 E/I，d2 使用 S/N，d3 使用 F/T，d4 使用 J/P；标签和维度名要贴合主题。
3. 不要生成 questions 数组，不要生成 results 数组。
4. 文案要有趣、具体、适合中文用户分享；不要出现“科学诊断”“心理治疗”“疾病”等专业诊断措辞。
`.trim();
}

export function buildQuestionsPrompt(topic, dimension) {
  return `
请为主题「${topic}」的一个维度生成 3 道情景题。

维度：
{
  "id": "${dimension.id}",
  "name": "${dimension.name}",
  "positiveCode": "${dimension.positiveCode}",
  "positiveLabel": "${dimension.positiveLabel}",
  "negativeCode": "${dimension.negativeCode}",
  "negativeLabel": "${dimension.negativeLabel}",
  "description": "${dimension.description}"
}

必须只返回一个合法 JSON object，不要 Markdown，不要解释。JSON schema 如下：
{
  "questions": [
    {
      "dimensionId": "${dimension.id}",
      "text": "题目文本",
      "options": [
        { "text": "强烈偏向 ${dimension.positiveLabel} 的选项", "score": 2 },
        { "text": "稍微偏向 ${dimension.positiveLabel} 的选项", "score": 1 },
        { "text": "中间状态/看情况的选项", "score": 0 },
        { "text": "稍微偏向 ${dimension.negativeLabel} 的选项", "score": -1 },
        { "text": "强烈偏向 ${dimension.negativeLabel} 的选项", "score": -2 }
      ]
    }
  ]
}

硬性要求：
1. questions 必须正好 3 道，dimensionId 必须全部是 "${dimension.id}"。
2. 每题必须正好 5 个选项，score 必须按 2、1、0、-1、-2 覆盖完整五档。
3. 每题必须包含一个中间/看情况选项，不能让用户只能二选一。
4. 题目要具体、有画面感，避免重复问法。
`.trim();
}

export function buildResultsPrompt(topic, dimensions, typeCodes, resultTone = {}) {
  const dimensionSummary = dimensions.map((dimension) => ({
    name: dimension.name,
    positiveCode: dimension.positiveCode,
    positiveLabel: dimension.positiveLabel,
    negativeCode: dimension.negativeCode,
    negativeLabel: dimension.negativeLabel,
    description: dimension.description
  }));

  return `
请为主题「${topic}」生成趣味测评结果解析，注意测评背景。它用于社交分享和自我表达，建议与优势要针对个人生活。

维度定义：
${JSON.stringify(dimensionSummary, null, 2)}

整体语气参考：
${JSON.stringify(resultTone || {}, null, 2)}

本次只生成这些 typeCode：
${JSON.stringify(typeCodes)}

必须只返回一个合法 JSON object，不要 Markdown，不要解释。JSON schema 如下：
{
  "results": [
    {
      "typeCode": "ESFJ",
      "name": "结果名称，6 到 12 个中文字符，贴合主题",
      "emoji": "一个相关 emoji",
      "summary": "结果摘要，45 到 80 字，具体、有画面感",
      "strengths": ["优势 1", "优势 2", "优势 3"],
      "suggestions": ["建议 1", "建议 2"]
    }
  ]
}

硬性要求：
1. results 数量必须等于本次 typeCode 数量，且只能包含本次给出的 typeCode。
2. 每个结果必须解释四个字母分别对应的倾向，不要只是堆砌维度标签。
3. 文案要有主题感、可分享、有区分度，避免每个结果长得一样。
`.trim();
}

function parseJsonContent(content) {
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new AppError(502, 'DeepSeek 返回内容不是有效 JSON，请重试。');
    }
    try {
      return JSON.parse(match[0]);
    } catch {
      throw new AppError(502, 'DeepSeek 返回 JSON 解析失败，请重试。');
    }
  }
}

export async function requestDeepSeekJson(prompt, { maxTokens = 2000, temperature = 0.8 } = {}) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const model = process.env.DEEPSEEK_MODEL || DEFAULT_MODEL;
  const timeoutMs = resolveTimeoutMs();
  const maxRetries = resolveMaxRetries();
  const maxAttempts = maxRetries + 1;
  const endpoint = resolveEndpoint();

  if (!apiKey) {
    throw new AppError(500, '缺少 DEEPSEEK_API_KEY，请在 .env 中配置 DeepSeek API Key 后重试。');
  }

  const requestBody = {
    model,
    temperature,
    max_tokens: maxTokens,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: '你是 QuizForge 的问卷生成器。必须输出严格合法的 JSON object，不能输出 Markdown。'
      },
      {
        role: 'user',
        content: prompt
      }
    ]
  };

  if (shouldDisableThinking(model)) {
    requestBody.thinking = { type: 'disabled' };
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          // 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 Edg/147.0.0.0',
          'Accept': '*/*', 
          'User-Agent': 'node-fetch'
        },
        body: JSON.stringify(requestBody)
      });

      const rawBody = await response.text();
      let payload = null;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        const error = markRetryable(new AppError(502, 'DeepSeek API 响应不是有效 JSON，请重试。', {
          status: response.status,
          bodyStart: rawBody.slice(0, 240)
        }), true);
        logApiError({
          stage: 'parse-response',
          endpoint,
          model,
          status: response.status,
          attempt,
          maxAttempts,
          willRetry: attempt < maxAttempts,
          message: 'API response is not JSON',
          bodyStart: rawBody.slice(0, 800)
        });
        throw error;
      }

      if (!response.ok) {
        const retryable = isRetryableStatus(response.status);
        const message = payload?.error?.message || `DeepSeek API 请求失败，状态码 ${response.status}`;
        const error = markRetryable(new AppError(502, message, {
          status: response.status,
          error: payload?.error || null
        }), retryable);
        logApiError({
          stage: 'http-error',
          endpoint,
          model,
          status: response.status,
          attempt,
          maxAttempts,
          willRetry: retryable && attempt < maxAttempts,
          message,
          error: payload?.error || null,
          bodyStart: rawBody.slice(0, 800)
        });
        throw error;
      }

      const content = payload?.choices?.[0]?.message?.content;
      if (!content) {
        const choice = payload?.choices?.[0];
        const error = markRetryable(new AppError(502, 'DeepSeek 没有返回问卷内容，请重试。', {
          finishReason: choice?.finish_reason || null,
          messageKeys: choice?.message ? Object.keys(choice.message) : [],
          usage: payload?.usage || null
        }), true);
        logApiError({
          stage: 'empty-content',
          endpoint,
          model,
          status: response.status,
          attempt,
          maxAttempts,
          willRetry: attempt < maxAttempts,
          message: 'API returned empty content',
          finishReason: choice?.finish_reason || null,
          messageKeys: choice?.message ? Object.keys(choice.message) : [],
          usage: payload?.usage || null,
          responseId: payload?.id || null,
          bodyStart: rawBody.slice(0, 800)
        });
        throw error;
      }

      try {
        return {
          model,
          raw: content,
          data: parseJsonContent(content)
        };
      } catch (error) {
        if (error instanceof AppError) {
          markRetryable(error, true);
          logApiError({
            stage: 'content-json-error',
            endpoint,
            model,
            status: response.status,
            attempt,
            maxAttempts,
            willRetry: attempt < maxAttempts,
            message: error.message,
            contentStart: content.slice(0, 800)
          });
        }
        throw error;
      }
    } catch (error) {
      let currentError = error;
      if (error.name === 'AbortError') {
        currentError = markRetryable(new AppError(504, 'DeepSeek 生成超时，请稍后重试。', {
          timeoutMs,
          attempt,
          maxAttempts
        }), true);
        logApiError({
          stage: 'timeout',
          endpoint,
          model,
          attempt,
          maxAttempts,
          willRetry: attempt < maxAttempts,
          message: `API request timed out after ${timeoutMs}ms`,
          timeoutMs
        });
      } else if (!(error instanceof AppError)) {
        currentError = markRetryable(new AppError(502, 'DeepSeek API 网络请求失败，请稍后重试。', {
          name: error.name,
          message: error.message
        }), true);
        logApiError({
          stage: 'network-error',
          endpoint,
          model,
          attempt,
          maxAttempts,
          willRetry: attempt < maxAttempts,
          message: error.message,
          name: error.name
        });
      }

      if (currentError.retryable && attempt < maxAttempts) {
        await wait(retryDelayMs(attempt));
        continue;
      }
      throw currentError;
    } finally {
      clearTimeout(timer);
    }
  }
}

export function generateQuizPlanWithDeepSeek(topic) {
  return requestDeepSeekJson(buildPlanPrompt(topic), { maxTokens: 1800 });
}

export function generateQuestionsWithDeepSeek(topic, dimension) {
  return requestDeepSeekJson(buildQuestionsPrompt(topic, dimension), { maxTokens: 2200 });
}

export function generateResultsWithDeepSeek(topic, dimensions, typeCodes, resultTone) {
  return requestDeepSeekJson(buildResultsPrompt(topic, dimensions, typeCodes, resultTone), {
    maxTokens: 2600,
    temperature: 0.82
  });
}
