import { renderHeader } from './components/header.js';
import { refreshIcons } from './icons.js';
import { homePage } from './pages/home.js';
import { creatorPage } from './pages/creator.js';
import { quizPage } from './pages/quiz.js';
import { resultPage } from './pages/result.js';

const routes = [
  { pattern: /^\/$/, page: homePage },
  { pattern: /^\/create$/, page: creatorPage },
  { pattern: /^\/quiz\/([^/]+)$/, page: quizPage, params: ['id'] },
  { pattern: /^\/result\/([^/]+)$/, page: resultPage, params: ['id'] }
];

function parseHash() {
  const raw = window.location.hash.slice(1) || '/';
  const [path, queryString = ''] = raw.split('?');
  return {
    path: path.startsWith('/') ? path : `/${path}`,
    query: new URLSearchParams(queryString)
  };
}

function matchRoute(path) {
  for (const route of routes) {
    const match = path.match(route.pattern);
    if (match) {
      const params = {};
      (route.params || []).forEach((name, index) => {
        params[name] = decodeURIComponent(match[index + 1]);
      });
      return { page: route.page, params };
    }
  }
  return { page: homePage, params: {} };
}

export function navigate(hashPath) {
  window.location.hash = hashPath;
}

async function renderRoute() {
  const app = document.querySelector('#app');
  const { path, query } = parseHash();
  const matched = matchRoute(path);
  const context = {
    path,
    query,
    params: matched.params,
    navigate
  };

  const html = await matched.page.render(context);
  app.innerHTML = `
    ${renderHeader()}
    <main class="page-shell">${html}</main>
  `;

  await matched.page.mount?.(context);
  refreshIcons();
}

export function startRouter() {
  window.addEventListener('hashchange', renderRoute);
  if (!window.location.hash) {
    window.location.hash = '#/';
    return;
  }
  renderRoute();
}
