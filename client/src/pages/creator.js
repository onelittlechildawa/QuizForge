import { api } from '../api.js';
import { refreshIcons } from '../icons.js';
import { buildShareUrl, copyText } from '../utils/share.js';
import { escapeHtml, renderError } from '../utils/dom.js';

function renderDimensions(dimensions) {
  return `
    <div class="dimension-grid">
      ${dimensions.map((dimension) => `
        <div class="dimension-item">
          <strong>${escapeHtml(dimension.name)}</strong>
          <span>${escapeHtml(dimension.positiveLabel)} / ${escapeHtml(dimension.negativeLabel)}</span>
        </div>
      `).join('')}
    </div>
  `;
}

function renderPreview(quiz) {
  const shareUrl = buildShareUrl(`/quiz/${quiz.id}`);

  return `
    <div class="success-panel">
      <span class="status-pill status-ready"><i data-lucide="check-circle-2"></i> 已生成</span>
      <h2>${escapeHtml(quiz.title)}</h2>
      <p>${escapeHtml(quiz.intro)}</p>
      ${renderDimensions(quiz.dimensions)}
      <div class="preview-list">
        ${quiz.questions.slice(0, 4).map((question, index) => `
          <div class="preview-question">
            <span>${index + 1}</span>
            <p>${escapeHtml(question.text)}</p>
          </div>
        `).join('')}
      </div>
      <div class="share-strip">
        <code>${escapeHtml(shareUrl)}</code>
        <button class="icon-button" id="copyQuizLink" type="button" title="复制链接">
          <i data-lucide="copy"></i>
        </button>
      </div>
      <div class="action-row">
        <a class="button button-primary" href="#/quiz/${encodeURIComponent(quiz.id)}">
          <i data-lucide="play"></i>
          <span>开始答题</span>
        </a>
        <a class="button button-secondary" href="#/">
          <i data-lucide="home"></i>
          <span>回首页</span>
        </a>
      </div>
    </div>
  `;
}

export const creatorPage = {
  async render(context) {
    const topic = context.query.get('topic') || '';

    return `
      <section class="workspace-layout">
        <div class="side-note">
          <span class="eyebrow"><i data-lucide="wand-sparkles"></i> DeepSeek 生成</span>
          <h1>创建一份新测评</h1>
          <p>默认使用 DeepSeek v4-pro。生成失败时会直接提示错误，方便你确认 API Key 或网络状态。</p>
          <div class="info-list">
            <span><i data-lucide="database"></i> SQLite 本地持久化</span>
            <span><i data-lucide="link"></i> 短链接分享</span>
            <span><i data-lucide="bar-chart-3"></i> 类人格维度评分</span>
          </div>
        </div>

        <div class="creator-stack">
          <form class="form-panel" id="creatorForm">
            <label for="creatorTopic">主题</label>
            <textarea id="creatorTopic" name="topic" maxlength="48" rows="3" placeholder="例如：你是哪种咖啡">${escapeHtml(topic)}</textarea>
            <button class="button button-primary button-wide" type="submit" id="generateButton">
              <i data-lucide="sparkles"></i>
              <span>生成测评</span>
            </button>
          </form>
          <section id="creatorStatus" class="status-area"></section>
        </div>
      </section>
    `;
  },

  async mount(context) {
    const form = document.querySelector('#creatorForm');
    const input = document.querySelector('#creatorTopic');
    const button = document.querySelector('#generateButton');
    const status = document.querySelector('#creatorStatus');
    let latestQuiz = null;

    async function createQuiz() {
      const topic = input.value.trim();
      if (!topic) {
        input.focus();
        return;
      }

      button.disabled = true;
      status.innerHTML = `
        <div class="generating-panel">
          <i data-lucide="loader-circle" class="spin"></i>
          <h2>正在生成测评</h2>
          <p>DeepSeek 正在组织维度、题目和 16 个结果类型。</p>
          <div class="step-list">
            <span>分析主题</span>
            <span>设计维度</span>
            <span>生成题目</span>
            <span>整理报告</span>
          </div>
        </div>
      `;
      refreshIcons();

      try {
        const { quiz } = await api.createQuiz(topic);
        latestQuiz = quiz;
        status.innerHTML = renderPreview(quiz);
        document.querySelector('#copyQuizLink').addEventListener('click', async () => {
          await copyText(buildShareUrl(`/quiz/${latestQuiz.id}`));
          document.querySelector('#copyQuizLink').classList.add('is-done');
          setTimeout(() => document.querySelector('#copyQuizLink')?.classList.remove('is-done'), 1200);
        });
      } catch (error) {
        status.innerHTML = renderError(error.message);
      } finally {
        button.disabled = false;
        refreshIcons();
      }
    }

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      createQuiz();
    });

    if (context.query.get('auto') === '1' && input.value.trim()) {
      createQuiz();
    }
  }
};
