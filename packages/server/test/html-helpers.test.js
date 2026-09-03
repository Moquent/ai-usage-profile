import { formatInlineMarkdown } from "../src/html/inline-markdown.js";
import { escapeHtml } from "../src/html/escape.js";

describe("html helpers", () => {
  it("escapes HTML entities", () => {
    expect(escapeHtml(`a&b<"c>`)).toBe("a&amp;b&lt;&quot;c&gt;");
  });

  it("renders bold and safe links in inline markdown", () => {
    const html = formatInlineMarkdown("**AS IS** and [Terms](/terms)");
    expect(html).toContain("<strong>AS IS</strong>");
    expect(html).toContain('<a href="/terms">Terms</a>');
    expect(formatInlineMarkdown("[bad](javascript:evil)")).toBe("bad");
    expect(formatInlineMarkdown("[evil](//evil.com)")).toBe("evil");
  });
});
