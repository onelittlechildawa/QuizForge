import { AppError } from '../errors.js';

const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions';
const DEFAULT_MODEL = 'deepseek-v4-pro';

function buildPrompt(topic) {
  return `
请为主题「${topic}」生成一个结构化娱乐测评问卷。它是用于社交分享和自我表达的趣味测评，不是心理诊断。

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
  "questions": [
    {
      "id": "q1",
      "dimensionId": "d1",
      "text": "题目文本",
      "options": [
        { "id": "a", "text": "选项文本", "score": 1 },
        { "id": "b", "text": "选项文本", "score": -1 }
      ]
    }
  ],
  "results": [
    {
      "typeCode": "ESFJ",
      "name": "结果名称",
      "emoji": "一个相关 emoji",
      "summary": "结果摘要，60 字以内",
      "strengths": ["优势 1", "优势 2", "优势 3"],
      "suggestions": ["建议 1", "建议 2"]
    }
  ]
}

硬性要求：
1. dimensions 必须正好 4 个，id 必须依次为 d1、d2、d3、d4。
2. 4 个维度代码必须分别是：d1 使用 E/I，d2 使用 S/N，d3 使用 F/T，d4 使用 J/P；标签和维度名要贴合主题。
3. questions 必须正好 12 道，每个维度正好 3 道题；每题 2 到 4 个选项；选项 score 只能是 1 或 -1。
4. results 必须覆盖 16 个 typeCode：ESFJ、ESFP、ESTJ、ESTP、ENFJ、ENFP、ENTJ、ENTP、ISFJ、ISFP、ISTJ、ISTP、INFJ、INFP、INTJ、INTP。
5. 文案要有趣、具体、适合中文用户分享；不要出现“科学诊断”“心理治疗”“疾病”等专业诊断措辞。
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

export async function generateQuizWithDeepSeek(topic) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const model = process.env.DEEPSEEK_MODEL || DEFAULT_MODEL;
  const timeoutMs = Number(process.env.DEEPSEEK_TIMEOUT_MS || 45000);

  if (!apiKey) {
    throw new AppError(500, '缺少 DEEPSEEK_API_KEY，请在 .env 中配置 DeepSeek API Key 后重试。');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(DEEPSEEK_ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        temperature: 0.8,
        max_tokens: 7000,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: '你是 QuizForge 的问卷生成器。必须输出严格合法的 JSON object，不能输出 Markdown。'
          },
          {
            role: 'user',
            content: buildPrompt(topic)
          }
        ]
      })
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      const message = payload?.error?.message || `DeepSeek API 请求失败，状态码 ${response.status}`;
      throw new AppError(502, message, payload);
    }

    const content = payload?.choices?.[0]?.message?.content;
    if (!content) {
      throw new AppError(502, 'DeepSeek 没有返回问卷内容，请重试。', payload);
    }

    return {
      model,
      raw: content,
      quiz: parseJsonContent(content)
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
