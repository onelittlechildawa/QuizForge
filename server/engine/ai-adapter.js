import { AppError } from '../errors.js';

const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-v4-flash';
const DEFAULT_TIMEOUT_MS = 120000;

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
      "description": "这个维度衡量什么，40 字以内"
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
  const timeoutMs = Number(process.env.DEEPSEEK_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const endpoint = resolveEndpoint();

  if (!apiKey) {
    throw new AppError(500, '缺少 DEEPSEEK_API_KEY，请在 .env 中配置 DeepSeek API Key 后重试。');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
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

    const response = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    const rawBody = await response.text();
    let payload = null;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      throw new AppError(502, 'DeepSeek API 响应不是有效 JSON，请重试。', {
        status: response.status,
        bodyStart: rawBody.slice(0, 240)
      });
    }

    if (!response.ok) {
      const message = payload?.error?.message || `DeepSeek API 请求失败，状态码 ${response.status}`;
      throw new AppError(502, message, payload);
    }

    const content = payload?.choices?.[0]?.message?.content;
    if (!content) {
      const choice = payload?.choices?.[0];
      throw new AppError(502, 'DeepSeek 没有返回问卷内容，请重试。', {
        finishReason: choice?.finish_reason || null,
        messageKeys: choice?.message ? Object.keys(choice.message) : [],
        usage: payload?.usage || null
      });
    }

    return {
      model,
      raw: content,
      data: parseJsonContent(content)
    };
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new AppError(504, 'DeepSeek 生成超时，请稍后重试。');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function generateQuizPlanWithDeepSeek(topic) {
  return requestDeepSeekJson(buildPlanPrompt(topic), { maxTokens: 1800 });
}

export function generateQuestionsWithDeepSeek(topic, dimension) {
  return requestDeepSeekJson(buildQuestionsPrompt(topic, dimension), { maxTokens: 2200 });
}
