import { z } from "zod";
import {
  escapeXml,
  formatValidationError,
  getProviderMetadata,
  listProviders,
  parseLabelsParam,
  parseStatsParam,
  publicCardUrl,
  resolvePublicOrigin,
  toCardOptions,
} from "../src/schema.js";

describe("shared schema helpers", () => {
  it("resolves public origins and card URLs", () => {
    expect(resolvePublicOrigin(undefined, { AI_USAGE_ENDPOINT: "https://env.example" }))
      .toBe("https://env.example");
    expect(resolvePublicOrigin("https://explicit.example")).toBe("https://explicit.example");
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
