import { renderHomePage } from "../src/site/home.js";

describe("home page", () => {
  it("renders minimal HTML with activity grid", () => {
    const html = renderHomePage("https://aiusage.teje.sh");
    expect(html).toMatch(/<title>AI Usage Profile<\/title>/);
    expect(html).toMatch(/npx ai-usage-profile setup/);
    expect(html).toMatch(/class="grid"/);
    expect(html).toMatch(/class="cell l4"/);
    expect(html).not.toMatch(/gradient|linear-gradient/i);
  });
});
