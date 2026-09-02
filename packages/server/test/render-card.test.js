import { LAYOUTS, STAT_CATALOG, parseUsageSnapshot } from "@ai-usage/shared";
import { formatCompact, formatDuration, renderCard } from "../src/render/card.js";
import { loadUsageSnapshot } from "../../test-support/helpers.js";

const generatedAt = new Date("2026-08-27T12:00:00.000Z");

describe("card rendering", () => {
  let fixture;

  beforeAll(async () => {
    fixture = await loadUsageSnapshot();
  });

  function render(layout, overrides = {}) {
    return renderCard({
      snapshot: fixture,
      username: "Moquent",
      theme: "dark",
      layout,
      generatedAt,
      ...overrides,
    });
  }

  it("formats card values consistently", () => {
    expect(formatCompact(5_100_000_000)).toBe("5.1B");
    expect(formatCompact(976_500_000)).toBe("976.5M");
    expect(formatCompact(42)).toBe("42");
    expect(formatCompact(null)).toBe("—");
    expect(formatDuration(44_820)).toBe("12h 27m");
    expect(formatDuration(90)).toBe("1m 30s");
    expect(formatDuration(15)).toBe("15s");
    expect(formatDuration(null)).toBe("—");
  });

  it("renders a compact graph layout", () => {
    const svg = render("graph");
    expect(svg).toMatch(/viewBox="0 0 760 194"/);
    expect(svg).toMatch(/Codex token activity|ACCOUNT-WIDE · DAILY · 2026-08-27/);
    expect((svg.match(/class="activity-cell"/g) ?? []).length).toBe(371);
    expect(svg).not.toMatch(/5\.1B|@moquent|Lifetime usage/);
  });

  it("renders stats without the activity grid", () => {
    const svg = render("stats");
    expect(svg).toMatch(/viewBox="0 0 760 146"/);
    expect(svg).toMatch(/5\.1B|976\.5M|12h 27m/);
    expect(svg).toMatch(/@moquent · Pro/);
    expect(svg).not.toMatch(/class="activity-cell"/);
  });

  it("composes profile and full layouts from the same modules", () => {
    const profile = render("profile");
    const full = render("full");
    expect(profile).toMatch(/viewBox="0 0 760 338"/);
    expect((profile.match(/class="activity-cell"/g) ?? []).length).toBe(371);
    expect(profile).not.toMatch(/>Scope</);
    expect(full).toMatch(/viewBox="0 0 760 414"/);
    expect(full).toMatch(/>Scope|OpenAI Codex App Server/);
  });

  it("supports stat selection, reordering, relabeling, and detached identity", () => {
    const svg = render("stats", {
      stats: ["current-streak", "lifetime", "active-days"],
      statLabels: { lifetime: "All-time tokens" },
      showIdentity: false,
    });
    expect(svg).toMatch(/viewBox="0 0 760 94"/);
    expect(svg).not.toMatch(/@moquent|>MO</);
    expect(svg).toMatch(/All-time tokens|>6 days</);
    expect(svg.indexOf("Current streak")).toBeLessThan(svg.indexOf("All-time tokens"));
  });

  it("compacts profile geometry when modules are omitted", () => {
    expect(render("profile", { stats: [] })).toMatch(/viewBox="0 0 760 252"/);
    expect(
      render("profile", { stats: ["lifetime", "peak", "reported-days"], showIdentity: false }),
    ).toMatch(/viewBox="0 0 760 282"/);
  });

  it("keeps every layout pure and GitHub-safe", () => {
    for (const layout of Object.keys(LAYOUTS)) {
      const svg = render(layout);
      expect(svg).toMatch(/^<svg /);
      expect(svg).not.toMatch(/foreignObject|script|data:/i);
    }
  });

  it("escapes user-controlled and provider-controlled text", () => {
    const svg = renderCard({
      snapshot: {
        ...fixture,
        provider: { id: "test", name: "A<B", source: "C&D" },
      },
      username: "a<b&c",
      theme: "dark",
      layout: "full",
      statLabels: { lifetime: "All <tokens> & usage" },
      generatedAt,
    });
    expect(svg).toMatch(/a&lt;b&amp;c|All &lt;tokens&gt; &amp; usage|A&lt;B|C&amp;D/);
    expect(svg).not.toMatch(/a<b&c/);
  });

  it("uses provider metadata without provider-specific branches", () => {
    const snapshot = {
      ...fixture,
      provider: { id: "claude-code", name: "Claude Code", source: "Test adapter" },
      account: { plan: null },
      metrics: { ...fixture.metrics, peakDailyTokens: null },
    };
    const svg = renderCard({
      snapshot,
      username: "Moquent",
      theme: "dark",
      layout: "full",
      generatedAt,
    });
    expect(svg).toMatch(/Claude Code token activity|@moquent · Claude Code|Test adapter|>—</);
    expect(svg).not.toMatch(/Codex/);
  });

  it("rejects invalid configuration and snapshots", () => {
    expect(() => render("portrait")).toThrow();
    expect(() => render("stats", { stats: [] })).toThrow();
    expect(() => render("stats", { stats: ["peak", "peak"] })).toThrow();
    expect(() => render("stats", { stats: Object.keys(STAT_CATALOG) })).toThrow();
    expect(() => render("stats", { statLabels: { peak: "" } })).toThrow();
    expect(() => parseUsageSnapshot({
      ...fixture,
      daily: [
        { date: "2026-08-20", tokens: 1 },
        { date: "2026-08-20", tokens: 2 },
      ],
    })).toThrow();
    expect(() => parseUsageSnapshot({
      ...fixture,
      metrics: { ...fixture.metrics, lifetimeTokens: -1 },
    })).toThrow();
  });
});
