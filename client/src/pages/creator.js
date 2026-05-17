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

const generationSteps = [
  { key: 'connect', icon: 'plug', title: '连接 DeepSeek' },
  { key: 'plan', icon: 'scan-search', title: '生成设定' },
  { key: 'dimensions', icon: 'git-branch', title: '确定维度' },
  { key: 'questions-d1', icon: 'list-checks', title: '第 1 组题目' },
  { key: 'questions-d2', icon: 'list-checks', title: '第 2 组题目' },
  { key: 'questions-d3', icon: 'list-checks', title: '第 3 组题目' },
  { key: 'questions-d4', icon: 'list-checks', title: '第 4 组题目' },
  { key: 'results', icon: 'sparkles', title: '整理结果' },
  { key: 'saving', icon: 'database', title: '保存问卷' }
];

function getStepIndex(step = '') {
  if (step.endsWith('-done')) {
    step = step.replace('-done', '');
  }
  const exact = generationSteps.findIndex((item) => item.key === step);
  return exact >= 0 ? exact : 0;
}

function renderGenerating(state = {}) {
  const activeIndex = getStepIndex(state.step);
  const progress = Math.max(0, Math.min(100, Number(state.progress || 0)));
  return `
    <div class="generating-panel">
      <div class="generation-head">
        <i data-lucide="loader-circle" class="spin"></i>
        <div>
          <h2>${escapeHtml(state.message || '正在生成测评')}</h2>
          <p>${escapeHtml(state.detail || '后端正在分块处理生成任务。')}</p>
        </div>
      </div>
      <div class="generation-progress">
        <span style="width: ${progress}%"></span>
      </div>
      <div class="generation-percent">${progress}%</div>
      <div class="generation-timeline">
        ${generationSteps.map((step, index) => `
          <div class="generation-step ${index < activeIndex ? 'is-done' : ''} ${index === activeIndex ? 'is-active' : ''}">
            <span><i data-lucide="${step.icon}"></i></span>
            <strong>${escapeHtml(step.title)}</strong>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderScoreLabel(score, dimension) {
  const value = Number(score);
  if (value === 0) return '中间';
  const label = value > 0 ? dimension?.positiveLabel : dimension?.negativeLabel;
  return `${value > 0 ? '+' : ''}${value} · ${label || '倾向'}`;
}

function renderQuestionEditor(quiz) {
  return `
    <div class="question-editor">
      ${quiz.questions.map((question, index) => {
        const dimension = quiz.dimensions.find((item) => item.id === question.dimensionId);
        return `
          <article class="editor-question">
            <div class="editor-question-head">
              <span>${index + 1}</span>
              <strong>${escapeHtml(dimension?.name || '维度')}</strong>
            </div>
            <label for="question-${question.id}">题目</label>
            <textarea id="question-${question.id}" data-question-text="${escapeHtml(question.id)}" maxlength="120" rows="2">${escapeHtml(question.text)}</textarea>
            <div class="editor-options">
              ${question.options.map((option) => `
                <label class="editor-option">
                  <span>${escapeHtml(renderScoreLabel(option.score, dimension))}</span>
                  <input data-option-text="${escapeHtml(question.id)}:${escapeHtml(option.id)}" maxlength="80" value="${escapeHtml(option.text)}" />
                </label>
              `).join('')}
            </div>
          </article>
        `;
      }).join('')}
    </div>
  `;
}

function renderPreview(quiz, saved = true) {
  const shareUrl = buildShareUrl(`/quiz/${quiz.id}`);

  return `
    <form class="success-panel" id="editQuizForm">
      <div class="editor-topline">
        <span class="status-pill status-ready"><i data-lucide="check-circle-2"></i> 已生成，可编辑</span>
        <span class="save-state" id="saveState">${saved ? '已保存' : '有未保存修改'}</span>
      </div>
      <label for="editTitle">标题</label>
      <input id="editTitle" maxlength="64" value="${escapeHtml(quiz.title)}" />
      <label for="editIntro">简介</label>
      <textarea id="editIntro" maxlength="120" rows="2">${escapeHtml(quiz.intro)}</textarea>
      ${renderDimensions(quiz.dimensions)}
      <div class="panel-head editor-section-head">
        <h2>题目编辑</h2>
        <span>12 题 · 每题 5 档选择</span>
      </div>
      ${renderQuestionEditor(quiz)}
      <div class="share-strip">
        <code>${escapeHtml(shareUrl)}</code>
        <button class="icon-button" id="copyQuizLink" type="button" title="复制链接">
          <i data-lucide="copy"></i>
        </button>
      </div>
      <div class="action-row">
        <button class="button button-secondary" type="submit" id="saveQuizButton">
          <i data-lucide="save"></i>
          <span>保存修改</span>
        </button>
        <a class="button button-primary" href="#/quiz/${encodeURIComponent(quiz.id)}">
          <i data-lucide="play"></i>
          <span>发布并试答</span>
        </a>
        <a class="button button-secondary" href="#/">
          <i data-lucide="home"></i>
          <span>回首页</span>
        </a>
      </div>
    </form>
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
          <p>模型由后端环境变量控制。生成失败时会直接提示错误，方便你确认 API Key 或网络状态。</p>
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
    let eventSource = null;

    function collectEditedQuiz() {
      return {
        title: document.querySelector('#editTitle').value.trim(),
        intro: document.querySelector('#editIntro').value.trim(),
        questions: latestQuiz.questions.map((question) => ({
          id: question.id,
          text: document.querySelector(`[data-question-text="${question.id}"]`).value.trim(),
          options: question.options.map((option) => ({
            id: option.id,
            text: document.querySelector(`[data-option-text="${question.id}:${option.id}"]`).value.trim()
          }))
        }))
      };
    }

    function bindEditor() {
      const editForm = document.querySelector('#editQuizForm');
      const saveButton = document.querySelector('#saveQuizButton');
      const saveState = document.querySelector('#saveState');

      editForm.addEventListener('input', () => {
        saveState.textContent = '有未保存修改';
        saveState.classList.add('is-dirty');
      });

      editForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        saveButton.disabled = true;
        saveButton.querySelector('span').textContent = '保存中';
        try {
          const { quiz } = await api.updateQuiz(latestQuiz.id, collectEditedQuiz());
          latestQuiz = quiz;
          status.innerHTML = renderPreview(quiz, true);
          bindEditor();
        } catch (error) {
          status.insertAdjacentHTML('afterbegin', renderError(error.message));
        } finally {
          refreshIcons();
        }
      });

      document.querySelector('#copyQuizLink').addEventListener('click', async () => {
        await copyText(buildShareUrl(`/quiz/${latestQuiz.id}`));
        document.querySelector('#copyQuizLink').classList.add('is-done');
        setTimeout(() => document.querySelector('#copyQuizLink')?.classList.remove('is-done'), 1200);
      });
    }

    async function createQuiz() {
      const topic = input.value.trim();
      if (!topic) {
        input.focus();
        return;
      }

      button.disabled = true;
      status.innerHTML = renderGenerating({
        step: 'connect',
        progress: 1,
        message: '正在创建任务',
        detail: '请求后端创建真实生成任务。'
      });
      refreshIcons();
      eventSource?.close();

      try {
        const { job } = await api.createQuizJob(topic);
        eventSource = new EventSource(job.eventUrl);

        eventSource.addEventListener('progress', (event) => {
          const progress = JSON.parse(event.data);
          status.innerHTML = renderGenerating(progress);
          refreshIcons();
        });

        eventSource.addEventListener('done', (event) => {
          const payload = JSON.parse(event.data);
          latestQuiz = payload.quiz;
          eventSource.close();
          eventSource = null;
          status.innerHTML = renderPreview(payload.quiz);
          bindEditor();
          button.disabled = false;
          refreshIcons();
        });

        eventSource.addEventListener('failed', (event) => {
          const payload = JSON.parse(event.data);
          eventSource.close();
          eventSource = null;
          status.innerHTML = renderError(payload.detail || '生成失败，请重试。');
          button.disabled = false;
          refreshIcons();
        });

        eventSource.onerror = () => {
          if (eventSource) {
            eventSource.close();
            eventSource = null;
            status.innerHTML = renderError('生成进度连接中断，请重试。');
            button.disabled = false;
            refreshIcons();
          }
        };
      } catch (error) {
        status.innerHTML = renderError(error.message);
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
