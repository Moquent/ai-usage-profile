import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LEGAL_DIR = fileURLToPath(new URL("../../../../legal/", import.meta.url));

const PAGES = Object.freeze({
  privacy: { file: "PRIVACY.md", title: "Privacy Policy" },
  terms: { file: "TERMS.md", title: "Terms of Service" },
});

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function markdownToHtml(markdown) {
  const lines = markdown.split("\n");
  const chunks = [];
  let listOpen = false;

  const closeList = () => {
    if (listOpen) {
      chunks.push("</ul>");
      listOpen = false;
    }
  };

  for (const line of lines) {
    if (line.startsWith("# ")) {
      closeList();
      chunks.push(`<h1>${escapeHtml(line.slice(2))}</h1>`);
      continue;
    }
    if (line.startsWith("## ")) {
      closeList();
      chunks.push(`<h2>${escapeHtml(line.slice(3))}</h2>`);
      continue;
    }
    if (line.startsWith("- ")) {
      if (!listOpen) {
        chunks.push("<ul>");
        listOpen = true;
      }
      chunks.push(`<li>${inlineMarkdown(escapeHtml(line.slice(2)))}</li>`);
      continue;
    }
    if (line.trim() === "") {
      closeList();
      continue;
    }
    closeList();
    chunks.push(`<p>${inlineMarkdown(escapeHtml(line))}</p>`);
  }
  closeList();
  return chunks.join("\n");
}

function inlineMarkdown(text) {
  return text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

function wrapPage(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} — AI Usage Profile</title>
  <style>
    body { font-family: system-ui, sans-serif; line-height: 1.55; max-width: 42rem; margin: 2rem auto; padding: 0 1rem; color: #1f2328; }
    h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
    h2 { font-size: 1.05rem; margin-top: 1.25rem; }
    p, li { margin: 0.45rem 0; }
    ul { padding-left: 1.25rem; }
    a { color: #0969da; }
    footer { margin-top: 2rem; font-size: 0.875rem; color: #57606a; }
    strong { font-weight: 600; }
  </style>
</head>
<body>
${bodyHtml}
<footer>
  <a href="/">Home</a> · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a> ·
  <a href="https://github.com/Moquent/ai-usage-profile">Source (MIT)</a>
</footer>
</body>
</html>`;
}

export async function renderLegalPage(id) {
  const page = PAGES[id];
  if (!page) return null;
  const markdown = await readFile(path.join(LEGAL_DIR, page.file), "utf8");
  return wrapPage(page.title, markdownToHtml(markdown));
}
