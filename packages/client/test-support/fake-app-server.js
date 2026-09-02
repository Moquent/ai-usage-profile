import readline from "node:readline";

const usage = {
  summary: {
    lifetimeTokens: 5_100_000_000,
    peakDailyTokens: 976_500_000,
    longestRunningTurnSec: 44_820,
    currentStreakDays: 4,
    longestStreakDays: 9,
  },
  dailyUsageBuckets: [{ startDate: "2026-08-26", tokens: 976_500_000 }],
};

const lines = readline.createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  const result = request.method === "account/read"
    ? { account: { type: "chatgpt", planType: "pro" }, requiresOpenaiAuth: true }
    : request.method === "account/usage/read"
      ? usage
      : {};
  process.stdout.write(`${JSON.stringify({ id: request.id, result })}\n`);
});
