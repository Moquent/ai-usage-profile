function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Static 14×7 grid — decorative, not live data. */
const GRID_PATTERN = [
  0, 0, 1, 0, 2, 1, 0, 0, 1, 3, 2, 1, 0, 0,
  0, 1, 1, 2, 2, 3, 2, 1, 2, 3, 4, 2, 1, 0,
  1, 0, 2, 3, 4, 3, 4, 3, 3, 4, 3, 2, 1, 0,
  0, 1, 2, 4, 4, 4, 3, 4, 4, 3, 2, 1, 0, 0,
  0, 0, 1, 2, 3, 4, 4, 3, 2, 2, 1, 0, 0, 0,
  0, 0, 0, 1, 2, 3, 3, 2, 1, 1, 0, 0, 0, 0,
  0, 0, 0, 0, 1, 2, 2, 1, 0, 0, 0, 0, 0, 0,
];

function renderGrid() {
  return GRID_PATTERN.map((level) =>
    `<span class="cell l${level}" aria-hidden="true"></span>`,
  ).join("");
}

export function renderHomePage(origin = "https://aiusage.teje.sh") {
  const base = escapeHtml(origin.replace(/\/$/, ""));
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AI Usage Profile</title>
  <style>
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 14px;
      line-height: 1.5;
      background: #fff;
      color: #000;
    }
    main { width: min(100%, 22rem); padding: 2rem 1.25rem; }
    h1 { font-size: 15px; font-weight: 700; letter-spacing: 0.02em; margin: 0 0 0.35rem; }
    p { margin: 0.35rem 0; }
    .muted { opacity: 0.55; }
    .grid {
      display: grid;
      grid-template-columns: repeat(14, 10px);
      gap: 3px;
      margin: 1.25rem 0 1.5rem;
    }
    .cell { width: 10px; height: 10px; background: #e8e8e8; }
    .cell.l1 { background: #bdbdbd; }
    .cell.l2 { background: #757575; }
    .cell.l3 { background: #424242; }
    .cell.l4 { background: #000; }
    code {
      display: block;
      margin: 1rem 0;
      padding: 0.65rem 0.75rem;
      border: 1px solid #000;
      font-size: 12px;
    }
    a { color: inherit; text-decoration: underline; text-underline-offset: 2px; }
    nav { margin-top: 1.5rem; font-size: 12px; }
    nav a { margin-right: 0.75rem; }
    @media (prefers-color-scheme: dark) {
      body { background: #000; color: #fff; }
      .cell { background: #1a1a1a; }
      .cell.l1 { background: #444; }
      .cell.l2 { background: #777; }
      .cell.l3 { background: #bbb; }
      .cell.l4 { background: #fff; }
      code { border-color: #fff; }
    }
  </style>
</head>
<body>
  <main>
    <h1>AI Usage Profile</h1>
    <p class="muted">Account-wide token stats on your GitHub profile.</p>
    <div class="grid">${renderGrid()}</div>
    <p>No prompts. No code. One SVG card.</p>
    <code>npx ai-usage-profile setup</code>
  <p class="muted"><a href="${base}/u/moquent/card.svg?theme=dark&amp;layout=profile&amp;identity=show&amp;stats=lifetime%2Cpeak%2Clongest-chat%2Ccurrent-streak%2Clongest-streak%2Cactive-days">Example card</a></p>
    <nav>
      <a href="https://github.com/Moquent/ai-usage-profile">GitHub</a>
      <a href="/terms">Terms</a>
      <a href="/privacy">Privacy</a>
    </nav>
  </main>
</body>
</html>`;
}
