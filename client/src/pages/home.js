import { api } from '../api.js';
import { refreshIcons } from '../icons.js';
import { escapeHtml, formatDate, renderError, renderLoader } from '../utils/dom.js';

const examples = [
  '你是哪种咖啡',
  '你的职场人格',
  '你适合哪座城市',
  '你的学习风格',
  '你是哪种电影角色',
  '你的周末能量类型'
];

function renderPopularList(quizzes) {
  if (!quizzes.length) {
    return `
      <div class="empty-state">
        <i data-lucide="sparkles"></i>
        <p>还没有公开测评，创建第一个吧。</p>
      </div>
    `;
  }

  return `
    <div class="quiz-grid">
      ${quizzes.map((quiz) => `
        <a class="quiz-tile" href="#/quiz/${encodeURIComponent(quiz.id)}">
          <span class="tile-kicker">${escapeHtml(quiz.topic)}</span>
          <strong>${escapeHtml(quiz.title)}</strong>
          <p>${escapeHtml(quiz.intro || '打开看看这份测评会把你归到哪一型。')}</p>
          <span class="tile-meta">
            <i data-lucide="users"></i>
            ${quiz.playCount || 0} 次完成
            ${quiz.createdAt ? ` · ${formatDate(quiz.createdAt)}` : ''}
          </span>
        </a>
      `).join('')}
    </div>
  `;
}

export const homePage = {
  async render() {
    return `
      <section class="home-layout">
        <div class="home-copy">
          <span class="eyebrow"><i data-lucide="sparkles"></i> 结构化娱乐测评</span>
          <h1>把一个灵感变成可以分享的趣味测评</h1>
          <p class="lead">输入主题，让 DeepSeek 生成 12 道题、4 个类人格维度和完整结果报告。</p>
        </div>

        <form class="create-panel" id="homeCreateForm">
          <label for="homeTopic">测评主题</label>
          <div class="topic-row">
            <input id="homeTopic" name="topic" type="text" maxlength="48" placeholder="例如：你是哪种咖啡" autocomplete="off" />
            <button class="button button-primary" type="submit">
              <i data-lucide="arrow-right"></i>
              <span>生成</span>
            </button>
          </div>
          <div class="example-row" aria-label="示例主题">
            ${examples.map((example) => `<button type="button" class="chip" data-topic="${escapeHtml(example)}">${escapeHtml(example)}</button>`).join('')}
          </div>
        </form>
      </section>

      <section class="section-head">
        <div>
          <span class="eyebrow">Popular</span>
          <h2>最近创建</h2>
        </div>
        <a class="text-link" href="#/create">新建测评 <i data-lucide="arrow-right"></i></a>
      </section>
      <section id="popularQuizzes">${renderLoader('正在读取本地测评')}</section>
    `;
  },

  async mount() {
    const form = document.querySelector('#homeCreateForm');
    const input = document.querySelector('#homeTopic');
    const popular = document.querySelector('#popularQuizzes');

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const topic = input.value.trim();
      if (!topic) {
        input.focus();
        return;
      }
      window.location.hash = `#/create?topic=${encodeURIComponent(topic)}&auto=1`;
    });

    document.querySelectorAll('[data-topic]').forEach((button) => {
      button.addEventListener('click', () => {
        input.value = button.dataset.topic;
        input.focus();
      });
    });

    try {
      const { quizzes } = await api.getPopularQuizzes();
      popular.innerHTML = renderPopularList(quizzes);
    } catch (error) {
      popular.innerHTML = renderError(error.message);
    }
    refreshIcons();
  }
};
