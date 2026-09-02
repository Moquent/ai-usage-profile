import {
  cardOptionsFromQuery,
  parseLabelsParam,
  parseStatsParam,
  presentationCardFromCli,
  presentationConfigSchema,
  presentationOverridesFromCli,
} from "@ai-usage/shared";

describe("presentation configuration", () => {
  it("merges CLI overrides into the stored card config", () => {
    const overrides = presentationOverridesFromCli({
      username: "cli-user",
      layout: "stats",
      stats: "lifetime,peak",
      labels: "lifetime=All-time",
      identity: false,
    });
    const config = presentationConfigSchema.parse({
      username: "file-user",
      layout: "graph",
      stats: ["current-streak"],
      labels: {},
      identity: true,
      ...overrides,
    });
    expect(config.username).toBe("cli-user");
    expect(config.layout).toBe("stats");
    expect(config.stats).toEqual(["lifetime", "peak"]);
    expect(config.labels).toEqual({ lifetime: "All-time" });
    expect(config.identity).toBe(false);
  });

  it("builds admin card payloads from CLI options", () => {
    const card = presentationCardFromCli({
      username: "Moquent",
      layout: "stats",
      stats: "lifetime,peak",
      identity: false,
    }, "moquent");
    expect(card).toMatchObject({
      username: "Moquent",
      layout: "stats",
      stats: ["lifetime", "peak"],
    });
  });

  it("parses card query parameters for public SVG requests", () => {
    const params = new URLSearchParams("theme=light&layout=graph&stats=none&identity=hide");
    const options = cardOptionsFromQuery(params, {
      username: "Moquent",
      layout: "graph",
      stats: ["lifetime"],
      labels: {},
      identity: true,
    });
    expect(options.theme).toBe("light");
    expect(options.layout).toBe("graph");
    expect(options.stats).toEqual([]);
    expect(options.showIdentity).toBe(false);
  });

  it("rejects duplicate and unknown stats", () => {
    expect(() => presentationConfigSchema.parse({ username: "user", stats: ["peak", "peak"] }))
      .toThrow(/duplicate/i);
    expect(() => presentationConfigSchema.parse({ username: "user", stats: ["unknown"] }))
      .toThrow(/Invalid option/i);
    expect(() => parseLabelsParam("peak=Maximum,peak=Peak")).toThrow(/Duplicate label override/);
    expect(parseStatsParam("none")).toEqual([]);
    expect(parseStatsParam("lifetime, peak")).toEqual(["lifetime", "peak"]);
  });
});
