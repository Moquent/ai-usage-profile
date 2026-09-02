import { CodexProvider } from "../src/codex.js";
import { PROVIDER_CATALOG } from "@ai-usage/shared";

function mockClientFactory(sequence) {
  let index = 0;
  return () => ({
    async start() {},
    async close() {},
    async request(method) {
      const handler = sequence[index];
      index += 1;
      if (typeof handler === "function") return handler(method);
      if (handler instanceof Error) throw handler;
      return handler;
    },
  });
}

describe("Codex provider errors", () => {
  it("rejects unsigned-in Codex accounts", async () => {
    await expect(new CodexProvider({
      clientFactory: mockClientFactory([{ account: null }]),
    }).fetch()).rejects.toThrow(/Codex is not signed in/);
  });

  it("rejects API-key and Bedrock authentication", async () => {
    await expect(new CodexProvider({
      clientFactory: mockClientFactory([{ account: { type: "apiKey" } }]),
    }).fetch()).rejects.toThrow(/API-key and Bedrock/);
    await expect(new CodexProvider({
      clientFactory: mockClientFactory([{ account: { type: "amazonBedrock" } }]),
    }).fetch()).rejects.toThrow(/API-key and Bedrock/);
  });

  it("rejects invalid account and usage payloads", async () => {
    await expect(new CodexProvider({
      clientFactory: mockClientFactory([{ account: { type: 42 } }]),
    }).fetch()).rejects.toThrow(/invalid account payload/);
    await expect(new CodexProvider({
      clientFactory: mockClientFactory([
        { account: { type: "chatgpt", planType: "pro" } },
        { summary: null },
      ]),
    }).fetch()).rejects.toThrow(/invalid summary/);
  });

  it("maps unknown plan labels and preserves provider metadata", async () => {
    const snapshot = await new CodexProvider({
      clientFactory: mockClientFactory([
        { account: { type: "chatgpt", planType: "custom_plan" } },
        {
          summary: {
            lifetimeTokens: 10,
            peakDailyTokens: 5,
            longestRunningTurnSec: 30,
            currentStreakDays: 1,
            longestStreakDays: 2,
          },
          dailyUsageBuckets: [{ startDate: "2026-08-26", tokens: 5 }],
        },
      ]),
    }).fetch();
    expect(snapshot.account.plan).toBe("custom_plan");
    expect(snapshot.provider).toEqual(PROVIDER_CATALOG.codex);
  });
});
