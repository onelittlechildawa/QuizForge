export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function formatDate(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value.replace(' ', 'T') + 'Z'));
}

export function renderError(message) {
  return `
    <div class="notice notice-error" role="alert">
      <i data-lucide="circle-alert"></i>
      <span>${escapeHtml(message)}</span>
    </div>
  `;
}

export function renderLoader(text = '加载中') {
  return `
    <div class="loader-block">
      <i data-lucide="loader-circle" class="spin"></i>
      <span>${escapeHtml(text)}</span>
    </div>
  `;
}
