import { renderHomePage } from "../src/site/home.js";

describe("home page", () => {
  it("renders minimal public landing HTML", () => {
    const html = renderHomePage();
    expect(html).toMatch(/<title>AI Usage Profile<\/title>/);
    expect(html).toMatch(/npx ai-usage-profile setup/);
    expect(html).toMatch(/href="\/terms"/);
    expect(html).toMatch(/href="\/privacy"/);
    expect(html).not.toMatch(/teje\.sh|moquent|class="grid"/i);
  });
});
