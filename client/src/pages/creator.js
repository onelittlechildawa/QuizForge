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
  { key: 'parallel', icon: 'blocks', title: '并行批处理' },
  { key: 'questions-d1', icon: 'list-checks', title: '第 1 组题目' },
  { key: 'questions-d2', icon: 'list-checks', title: '第 2 组题目' },
  { key: 'questions-d3', icon: 'list-checks', title: '第 3 组题目' },
  { key: 'questions-d4', icon: 'list-checks', title: '第 4 组题目' },
  { key: 'results-1', icon: 'sparkles', title: '结果解析 1' },
  { key: 'results-2', icon: 'sparkles', title: '结果解析 2' },
  { key: 'results-3', icon: 'sparkles', title: '结果解析 3' },
  { key: 'results-4', icon: 'sparkles', title: '结果解析 4' },
  { key: 'saving', icon: 'database', title: '保存问卷' }
];

function resolveStepKey(step = '') {
  if (step.endsWith('-done')) {
    return step.replace('-done', '');
  }
  return step;
}

function getStepIndex(step = '') {
  step = resolveStepKey(step);
  if (step === 'results') {
    step = 'results-1';
  }
  const exact = generationSteps.findIndex((item) => item.key === step);
  return exact >= 0 ? exact : 0;
}

function isParallelTaskKey(key) {
  return key.startsWith('questions-') || key.startsWith('results-');
}

function createGenerationPreview() {
  return {
    dimensions: [],
    questionBatches: [],
    resultBatches: [],
    completedSteps: [],
    parallel: null
  };
}

function upsertBatch(items, batch) {
  const index = items.findIndex((item) => item.index === batch.index);
  const next = [...items];
  if (index >= 0) {
    next[index] = batch;
  } else {
    next.push(batch);
  }
  return next.sort((a, b) => a.index - b.index);
}

function mergeGenerationPreview(current, incoming) {
  if (!incoming) return current;

  if (Array.isArray(incoming.dimensions)) {
    current.dimensions = incoming.dimensions;
  }
  if (incoming.questionBatch) {
    current.questionBatches = upsertBatch(current.questionBatches, incoming.questionBatch);
  }
  if (incoming.resultBatch) {
    current.resultBatches = upsertBatch(current.resultBatches, incoming.resultBatch);
  }
  if (incoming.parallel) {
    current.parallel = incoming.parallel;
  }

  const completedSteps = new Set(current.completedSteps);
  if (Array.isArray(incoming.completedSteps)) {
    incoming.completedSteps.forEach((step) => completedSteps.add(step));
  }
  if (incoming.completedStep) {
    completedSteps.add(incoming.completedStep);
  }
  current.completedSteps = [...completedSteps];
  return current;
}

function renderGenerationInsights(preview = createGenerationPreview()) {
  const dimensions = preview.dimensions || [];
  const questionBatches = preview.questionBatches || [];
  const resultBatches = preview.resultBatches || [];
  const recentQuestions = questionBatches.flatMap((batch) => (
    (batch.questions || []).map((question) => ({
      ...question,
      dimensionName: batch.dimensionName
    }))
  )).slice(-6);
  const recentResults = resultBatches.flatMap((batch) => batch.results || []).slice(-8);
  const questionCount = preview.parallel?.questionCount ?? questionBatches.reduce((sum, batch) => sum + (batch.questions?.length || 0), 0);
  const resultCount = preview.parallel?.resultCount ?? resultBatches.reduce((sum, batch) => sum + (batch.results?.length || 0), 0);
  const completed = preview.parallel?.completed ?? 0;
  const total = preview.parallel?.total ?? 8;

  if (!dimensions.length && !recentQuestions.length && !recentResults.length && !preview.parallel) {
    return '';
  }

  return `
    <div class="generation-insights">
      <div class="generation-insight-head">
        <strong>生成预览</strong>
        <span>${completed}/${total} 批 · ${questionCount}/12 题 · ${resultCount}/16 结果</span>
      </div>
      ${dimensions.length ? `
        <div class="preview-section">
          <span class="preview-label">维度</span>
          <div class="preview-dimension-row">
            ${dimensions.map((dimension) => `
              <div class="preview-dimension">
                <strong>${escapeHtml(dimension.name)}</strong>
                <span>${escapeHtml(dimension.positiveLabel)} / ${escapeHtml(dimension.negativeLabel)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
      ${recentQuestions.length ? `
        <div class="preview-section">
          <span class="preview-label">题目片段</span>
          <div class="preview-snippet-list">
            ${recentQuestions.map((question) => `
              <div class="preview-snippet">
                <span>${escapeHtml(question.dimensionName)}</span>
                <p>${escapeHtml(question.text)}</p>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
      ${recentResults.length ? `
        <div class="preview-section">
          <span class="preview-label">结果解析</span>
          <div class="preview-result-grid">
            ${recentResults.map((result) => `
              <div class="preview-result">
                <span>${escapeHtml(result.emoji)} ${escapeHtml(result.typeCode)}</span>
                <strong>${escapeHtml(result.name)}</strong>
                <p>${escapeHtml(result.summary)}</p>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

function renderGenerating(state = {}, preview = createGenerationPreview()) {
  const activeKey = resolveStepKey(state.step || '');
  const activeIndex = getStepIndex(state.step);
  const progress = Math.max(0, Math.min(100, Number(state.progress || 0)));
  const completedSteps = new Set(preview.completedSteps || []);
  const parallelDone = preview.parallel?.total > 0 && preview.parallel.completed >= preview.parallel.total;
  const parallelRunning = !parallelDone && (activeKey === 'parallel' || isParallelTaskKey(activeKey));
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
        ${generationSteps.map((step, index) => {
          const isDone = completedSteps.has(step.key)
            || (step.key === 'parallel' && parallelDone)
            || (!isParallelTaskKey(step.key) && step.key !== 'parallel' && index < activeIndex);
          const isActive = !isDone && (step.key === activeKey || (step.key === 'parallel' && parallelRunning));
          return `
            <div class="generation-step ${isDone ? 'is-done' : ''} ${isActive ? 'is-active' : ''}">
              <span><i data-lucide="${step.icon}"></i></span>
              <strong>${escapeHtml(step.title)}</strong>
            </div>
          `;
        }).join('')}
      </div>
      ${renderGenerationInsights(preview)}
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
    let generationPreview = createGenerationPreview();

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
      generationPreview = createGenerationPreview();
      status.innerHTML = renderGenerating({
        step: 'connect',
        progress: 1,
        message: '正在创建任务',
        detail: '请求后端创建真实生成任务。'
      }, generationPreview);
      refreshIcons();
      eventSource?.close();

      try {
        const { job } = await api.createQuizJob(topic);
        eventSource = new EventSource(job.eventUrl);

        eventSource.addEventListener('progress', (event) => {
          const progress = JSON.parse(event.data);
          generationPreview = mergeGenerationPreview(generationPreview, progress.preview);
          status.innerHTML = renderGenerating(progress, generationPreview);
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
