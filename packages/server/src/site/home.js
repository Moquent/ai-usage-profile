export function renderHomePage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AI Usage Profile</title>
  <style>
    :root { color-scheme: light dark; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: system-ui, sans-serif;
      font-size: 15px;
      line-height: 1.5;
      background: #fff;
      color: #111;
    }
    main { width: min(100%, 24rem); padding: 2rem 1.25rem; }
    h1 { font-size: 1.125rem; font-weight: 600; margin: 0 0 0.5rem; }
    p { margin: 0.5rem 0; }
    code {
      display: block;
      margin: 1rem 0;
      padding: 0.65rem 0.75rem;
      border: 1px solid currentColor;
      font-family: ui-monospace, monospace;
      font-size: 13px;
    }
    a { color: inherit; }
    nav { margin-top: 1.5rem; font-size: 14px; }
    nav a { margin-right: 1rem; }
    @media (prefers-color-scheme: dark) {
      body { background: #111; color: #f5f5f5; }
    }
  </style>
</head>
<body>
  <main>
    <h1>AI Usage Profile</h1>
    <p>Publish account-wide AI usage stats to a public SVG card for your GitHub profile.</p>
    <code>npx ai-usage-profile setup</code>
    <nav>
      <a href="/terms">Terms</a>
      <a href="/privacy">Privacy</a>
    </nav>
  </main>
</body>
</html>`;
}
