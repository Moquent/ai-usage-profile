import { z } from "zod";
import {
  buildCardSvgQuery,
  buildCardSvgUrl,
  DEFAULT_PROFILE_STATS,
  escapeXml,
  formatValidationError,
  getProviderMetadata,
  listProviders,
  normalizeLayout,
  parseLabelsParam,
  parseStatsParam,
  presentationCard,
  publishedCardPresentation,
  parseStoredPresentation,
  publicCardUrl,
  readmeCardSnippet,
  resolvePublicOrigin,
  toCardOptions,
} from "../src/schema.js";

describe("shared schema helpers", () => {
  it("builds README-safe card URLs with encoded query strings", () => {
    const query = buildCardSvgQuery();
    expect(query).toContain("stats=lifetime%2Cpeak");
    expect(query).not.toContain("stats=lifetime,peak");
    const url = buildCardSvgUrl("https://aiusage.teje.sh", "moquent");
    expect(url).toContain("layout=profile");
    expect(url).toContain("%2C");
    const snippet = readmeCardSnippet("https://aiusage.teje.sh", "moquent");
    expect(snippet).toMatch(/srcset="[^"]*&amp;/);
    expect(snippet).not.toMatch(/srcset="[^"]*[^&]&layout/);
  });

  it("resolves public origins and card URLs", () => {
    expect(resolvePublicOrigin(undefined, { AI_USAGE_ENDPOINT: "https://env.example" }))
      .toBe("https://env.example");
    expect(resolvePublicOrigin("https://explicit.example")).toBe("https://explicit.example");
    expect(resolvePublicOrigin(undefined, {})).toBe("https://aiusage.teje.sh");
    expect(publicCardUrl("https://usage.example.com", "Moquent"))
      .toBe("https://usage.example.com/u/moquent/card.svg");
  });

  it("escapes XML and formats validation errors", () => {
    expect(escapeXml(`a&b<"c'd>`)).toBe("a&amp;b&lt;&quot;c&apos;d&gt;");
    expect(formatValidationError(new Error("boom"))).toBe("boom");
    expect(typeof formatValidationError(new z.ZodError([]))).toBe("string");
  });

  it("lists providers and rejects unknown ids", () => {
    expect(listProviders()).toContain("codex");
    expect(() => getProviderMetadata("missing")).toThrow(/Unknown provider/);
  });

  it("normalizes legacy full layout to profile", () => {
    expect(normalizeLayout("full")).toBe("profile");
    expect(normalizeLayout("graph")).toBe("graph");
  });

  it("builds stored and published presentation configs", () => {
    const card = presentationCard("Moquent", { layout: "stats", stats: ["lifetime", "peak"], identity: false });
    expect(card).toMatchObject({
      username: "Moquent",
      layout: "stats",
      stats: ["lifetime", "peak"],
      identity: false,
    });
    const published = publishedCardPresentation("Moquent", { labels: { peak: "Best day" } });
    expect(published.layout).toBe("profile");
    expect(published.stats).toEqual([...DEFAULT_PROFILE_STATS]);
    expect(published.labels).toEqual({ peak: "Best day" });
    expect(presentationCard("Moquent", { layout: "full" }).layout).toBe("profile");
  });

  it("parses stored cards with legacy full layout", () => {
    const card = parseStoredPresentation({
      username: "Moquent",
      layout: "full",
      stats: ["lifetime"],
      labels: {},
      identity: true,
    });
    expect(card.layout).toBe("profile");
  });

  it("parses stats and labels from CLI strings", () => {
    expect(parseStatsParam(undefined)).toBeUndefined();
    expect(parseLabelsParam(undefined)).toBeUndefined();
    expect(() => parseLabelsParam("bad-label")).toThrow(/ID=Custom label/);
    expect(toCardOptions({
      username: "Moquent",
      layout: "graph",
      stats: ["lifetime"],
      labels: { lifetime: "All-time" },
      identity: false,
    })).toMatchObject({
      username: "Moquent",
      showIdentity: false,
      statLabels: { lifetime: "All-time" },
    });
  });
});
