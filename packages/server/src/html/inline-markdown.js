import { escapeHtml } from "./escape.js";

/**
 * Escapes text, then renders a minimal subset of markdown: **bold** and [links](url).
 */
export function formatInlineMarkdown(text) {
  const escaped = escapeHtml(text);
  const withBold = escaped.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  return withBold.replace(/\[([^\]]+)\]\((.*?)\)/g, (_, label, href) => {
    const safePath = href.startsWith("/") && !href.startsWith("//");
    if (!/^https?:\/\//i.test(href) && !safePath) return label;
    return `<a href="${escapeHtml(href)}">${label}</a>`;
  });
}
