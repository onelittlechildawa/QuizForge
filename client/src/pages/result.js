import QRCode from 'qrcode';
import {
  Chart,
  Filler,
  Legend,
  LineElement,
  PointElement,
  RadarController,
  RadialLinearScale,
  Tooltip
} from 'chart.js';
import { api } from '../api.js';
import { refreshIcons } from '../icons.js';
import { buildShareUrl, copyText, shareLink } from '../utils/share.js';
import { escapeHtml, renderError, renderLoader } from '../utils/dom.js';

Chart.register(RadarController, RadialLinearScale, PointElement, LineElement, Filler, Tooltip, Legend);

let activeChart = null;

function renderStats(stats, result) {
  if (!stats.total) {
    return '<p class="muted">这份测评还没有足够的统计数据。</p>';
  }
  const current = stats.distribution.find((item) => item.typeCode === result.typeCode);
  return `
    <div class="stat-row">
      <span><i data-lucide="users"></i> ${stats.total} 人完成</span>
      <span>${current ? `${current.percentage}% 得到 ${escapeHtml(result.typeCode)}` : '结果分布已更新'}</span>
    </div>
  `;
}

function renderResultPage(resultData, stats) {
  const result = resultData.result;
  const scores = resultData.scores.dimensions || [];
  const url = buildShareUrl(`/result/${resultData.id}`);

  return `
    <section class="result-layout">
      <article class="result-summary" id="resultCard">
        <span class="eyebrow"><i data-lucide="trophy"></i> ${escapeHtml(resultData.quiz.title)}</span>
        <div class="result-title-row">
          <span class="result-emoji">${escapeHtml(result?.emoji || '✨')}</span>
          <div>
            <h1>${escapeHtml(result?.name || resultData.typeCode)}</h1>
            <p>${escapeHtml(result?.summary || '这是你的本次测评结果。')}</p>
          </div>
        </div>
        <span class="type-badge">${escapeHtml(resultData.typeCode)}</span>
      </article>

      <section class="result-panel">
        <div class="panel-head">
          <h2>维度画像</h2>
          <span>${escapeHtml(resultData.quiz.topic)}</span>
        </div>
        <canvas id="radarChart" width="520" height="360"></canvas>
        <div class="score-list">
          ${scores.map((score) => `
            <div class="score-item">
              <div>
                <strong>${escapeHtml(score.name)}</strong>
                <span>${escapeHtml(score.selectedLabel)} ${score.selectedPercentage}%</span>
              </div>
              <div class="score-track">
                <span style="width: ${score.selectedPercentage}%"></span>
              </div>
            </div>
          `).join('')}
        </div>
      </section>

      <section class="result-panel">
        <div class="panel-head">
          <h2>结果解读</h2>
          <span>${escapeHtml(resultData.typeCode)}</span>
        </div>
        <div class="insight-grid">
          <div>
            <h3>优势</h3>
            <ul>${(result?.strengths || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
          </div>
          <div>
            <h3>建议</h3>
            <ul>${(result?.suggestions || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
          </div>
        </div>
      </section>

      <section class="result-panel">
        <div class="panel-head">
          <h2>分享</h2>
          <span>让朋友也测一下</span>
        </div>
        <div class="share-strip">
          <code>${escapeHtml(url)}</code>
          <button class="icon-button" id="copyResultLink" type="button" title="复制链接"><i data-lucide="copy"></i></button>
        </div>
        ${renderStats(stats, resultData)}
        <div class="action-row">
          <button class="button button-primary" id="nativeShare" type="button">
            <i data-lucide="share-2"></i>
            <span>分享</span>
          </button>
          <button class="button button-secondary" id="showQr" type="button">
            <i data-lucide="qr-code"></i>
            <span>二维码</span>
          </button>
          <button class="button button-secondary" id="downloadCard" type="button">
            <i data-lucide="download"></i>
            <span>下载卡片</span>
          </button>
        </div>
      </section>

      <div class="modal-backdrop" id="qrModal" hidden>
        <div class="modal">
          <div class="panel-head">
            <h2>扫码查看结果</h2>
            <button class="icon-button" id="closeQr" type="button" title="关闭"><i data-lucide="x"></i></button>
          </div>
          <canvas id="qrCanvas" width="220" height="220"></canvas>
        </div>
      </div>
    </section>
  `;
}

function drawChart(scores) {
  const canvas = document.querySelector('#radarChart');
  if (!canvas) return;
  activeChart?.destroy();
  activeChart = new Chart(canvas, {
    type: 'radar',
    data: {
      labels: scores.map((score) => score.name),
      datasets: [{
        label: '倾向强度',
        data: scores.map((score) => score.selectedPercentage),
        borderColor: '#2563eb',
        backgroundColor: 'rgba(37, 99, 235, 0.14)',
        pointBackgroundColor: '#0f766e',
        pointBorderColor: '#ffffff',
        pointRadius: 4,
        borderWidth: 2,
        fill: true
      }]
    },
    options: {
      responsive: true,
      scales: {
        r: {
          min: 0,
          max: 100,
          ticks: { stepSize: 25, color: '#64748b', backdropColor: 'transparent' },
          grid: { color: '#e2e8f0' },
          angleLines: { color: '#e2e8f0' },
          pointLabels: { color: '#0f172a', font: { size: 13, weight: '600' } }
        }
      },
      plugins: {
        legend: { display: false }
      }
    }
  });
}

function downloadResultCard(resultData) {
  const result = resultData.result;
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 1500;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.roundRect(90, 90, 1020, 1320, 36);
  ctx.fill();
  ctx.strokeStyle = '#dbe3ef';
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.fillStyle = '#2563eb';
  ctx.font = '700 42px Noto Sans SC, sans-serif';
  ctx.fillText('QuizForge 测趣工坊', 150, 190);

  ctx.fillStyle = '#0f172a';
  ctx.font = '800 76px Noto Sans SC, sans-serif';
  ctx.fillText(`${result?.emoji || '✨'} ${result?.name || resultData.typeCode}`, 150, 340);

  ctx.fillStyle = '#475569';
  ctx.font = '500 36px Noto Sans SC, sans-serif';
  wrapCanvasText(ctx, result?.summary || '这是你的测评结果。', 150, 430, 900, 54);

  ctx.fillStyle = '#0f766e';
  ctx.font = '800 120px Inter, sans-serif';
  ctx.fillText(resultData.typeCode, 150, 680);

  ctx.fillStyle = '#0f172a';
  ctx.font = '700 42px Noto Sans SC, sans-serif';
  ctx.fillText('维度倾向', 150, 810);

  let y = 900;
  for (const score of resultData.scores.dimensions || []) {
    ctx.fillStyle = '#334155';
    ctx.font = '600 32px Noto Sans SC, sans-serif';
    ctx.fillText(`${score.name} · ${score.selectedLabel}`, 150, y);
    ctx.fillStyle = '#dbe3ef';
    ctx.roundRect(150, y + 28, 760, 24, 12);
    ctx.fill();
    ctx.fillStyle = '#2563eb';
    ctx.roundRect(150, y + 28, 760 * (score.selectedPercentage / 100), 24, 12);
    ctx.fill();
    y += 120;
  }

  const link = document.createElement('a');
  link.download = `${resultData.typeCode}-quizforge.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight) {
  let line = '';
  for (const char of String(text)) {
    const test = line + char;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, y);
      line = char;
      y += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, y);
}

export const resultPage = {
  async render() {
    return `<section id="resultMount">${renderLoader('正在读取结果')}</section>`;
  },

  async mount(context) {
    const mount = document.querySelector('#resultMount');

    try {
      const { result } = await api.getResult(context.params.id);
      const { stats } = await api.getStats(result.quizId);
      const url = buildShareUrl(`/result/${result.id}`);

      mount.innerHTML = renderResultPage(result, stats);
      drawChart(result.scores.dimensions || []);

      document.querySelector('#copyResultLink').addEventListener('click', async () => {
        await copyText(url);
        document.querySelector('#copyResultLink').classList.add('is-done');
        setTimeout(() => document.querySelector('#copyResultLink')?.classList.remove('is-done'), 1200);
      });

      document.querySelector('#nativeShare').addEventListener('click', async () => {
        await shareLink({
          title: result.quiz.title,
          text: `我的结果是 ${result.result?.name || result.typeCode}`,
          url
        });
      });

      document.querySelector('#showQr').addEventListener('click', async () => {
        const modal = document.querySelector('#qrModal');
        modal.hidden = false;
        await QRCode.toCanvas(document.querySelector('#qrCanvas'), url, {
          margin: 1,
          width: 220,
          color: {
            dark: '#0f172a',
            light: '#ffffff'
          }
        });
      });

      document.querySelector('#closeQr').addEventListener('click', () => {
        document.querySelector('#qrModal').hidden = true;
      });

      document.querySelector('#downloadCard').addEventListener('click', () => downloadResultCard(result));
      refreshIcons();
    } catch (error) {
      mount.innerHTML = renderError(error.message);
      refreshIcons();
    }
  }
};
