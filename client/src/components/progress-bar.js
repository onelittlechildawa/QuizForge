export function renderProgressBar(current, total) {
  const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
  return `
    <div class="progress-wrap" aria-label="答题进度">
      <div class="progress-meta">
        <span>${current}/${total}</span>
        <strong>${percentage}%</strong>
      </div>
      <div class="progress-track">
        <span class="progress-fill" style="width: ${percentage}%"></span>
      </div>
    </div>
  `;
}
