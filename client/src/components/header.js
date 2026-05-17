export function renderHeader() {
  return `
    <header class="topbar">
      <a class="brand" href="#/">
        <span class="brand-mark"><i data-lucide="clipboard-check"></i></span>
        <span>
          <strong>QuizForge</strong>
          <small>测趣工坊</small>
        </span>
      </a>
      <nav class="topnav" aria-label="主导航">
        <a href="#/"><i data-lucide="home"></i><span>首页</span></a>
        <a class="button button-small button-primary" href="#/create">
          <i data-lucide="wand-sparkles"></i>
          <span>创建</span>
        </a>
      </nav>
    </header>
  `;
}
