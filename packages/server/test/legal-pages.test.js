import { renderLegalPage } from "../src/legal/pages.js";

describe("legal pages", () => {
  it("renders privacy and terms HTML", async () => {
    const privacy = await renderLegalPage("privacy");
    const terms = await renderLegalPage("terms");
    expect(privacy).toMatch(/<title>Privacy Policy/);
    expect(privacy).toMatch(/<strong>/);
    expect(privacy).toMatch(/do not store/i);
    expect(terms).toMatch(/<title>Terms of Service/);
    expect(terms).toMatch(/Limitation of liability/i);
    expect(terms).toMatch(/Indemnification/i);
    expect(await renderLegalPage("missing")).toBeNull();
  });

  it("does not render unsafe markdown links", async () => {
    const privacy = await renderLegalPage("privacy");
    expect(privacy).not.toMatch(/href="javascript:/i);
  });
});
