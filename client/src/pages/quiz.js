import { api } from '../api.js';
import { refreshIcons } from '../icons.js';
import { renderProgressBar } from '../components/progress-bar.js';
import { escapeHtml, renderError, renderLoader } from '../utils/dom.js';

function renderQuestion(quiz, index, answers, submitting = false) {
  const question = quiz.questions[index];
  const selected = answers[question.id];
  const isLast = index === quiz.questions.length - 1;

  return `
    <section class="quiz-runner">
      <div class="quiz-header">
        <a class="text-link" href="#/"><i data-lucide="chevron-left"></i> 首页</a>
        <span>${escapeHtml(quiz.title)}</span>
      </div>
      ${renderProgressBar(index + 1, quiz.questions.length)}
      <article class="question-panel">
        <span class="question-kicker">${escapeHtml(quiz.dimensions.find((dimension) => dimension.id === question.dimensionId)?.name || '')}</span>
        <h1>${escapeHtml(question.text)}</h1>
        <div class="option-list">
          ${question.options.map((option) => `
            <button class="option-button ${selected === option.id ? 'is-selected' : ''}" type="button" data-option="${escapeHtml(option.id)}">
              <span>${escapeHtml(option.text)}</span>
              <i data-lucide="${selected === option.id ? 'check-circle-2' : 'circle'}"></i>
            </button>
          `).join('')}
        </div>
      </article>
      <div class="quiz-controls">
        <button class="button button-secondary" type="button" id="prevQuestion" ${index === 0 ? 'disabled' : ''}>
          <i data-lucide="chevron-left"></i>
          <span>上一题</span>
        </button>
        <button class="button button-primary" type="button" id="nextQuestion" ${!selected || submitting ? 'disabled' : ''}>
          <span>${submitting ? '提交中' : isLast ? '查看结果' : '下一题'}</span>
          <i data-lucide="${submitting ? 'loader-circle' : 'arrow-right'}" class="${submitting ? 'spin' : ''}"></i>
        </button>
      </div>
      <div id="quizError"></div>
    </section>
  `;
}

export const quizPage = {
  async render() {
    return `<section id="quizMount">${renderLoader('正在加载测评')}</section>`;
  },

  async mount(context) {
    const mount = document.querySelector('#quizMount');
    const answers = {};
    let quiz = null;
    let index = 0;

    function draw(submitting = false) {
      mount.innerHTML = renderQuestion(quiz, index, answers, submitting);
      mount.querySelectorAll('[data-option]').forEach((button) => {
        button.addEventListener('click', () => {
          answers[quiz.questions[index].id] = button.dataset.option;
          if (index < quiz.questions.length - 1) {
            index += 1;
          }
          draw();
        });
      });

      mount.querySelector('#prevQuestion').addEventListener('click', () => {
        index = Math.max(index - 1, 0);
        draw();
      });

      mount.querySelector('#nextQuestion').addEventListener('click', async () => {
        if (!answers[quiz.questions[index].id]) return;
        if (index < quiz.questions.length - 1) {
          index += 1;
          draw();
          return;
        }

        draw(true);
        try {
          const { resultId } = await api.submitAnswers(quiz.id, answers);
          window.location.hash = `#/result/${encodeURIComponent(resultId)}`;
        } catch (error) {
          draw(false);
          mount.querySelector('#quizError').innerHTML = renderError(error.message);
          refreshIcons();
        }
      });

      refreshIcons();
    }

    try {
      const payload = await api.getQuiz(context.params.id);
      quiz = payload.quiz;
      draw();
    } catch (error) {
      mount.innerHTML = renderError(error.message);
      refreshIcons();
    }
  }
};
