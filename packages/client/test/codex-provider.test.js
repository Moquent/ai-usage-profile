import { fileURLToPath } from "node:url";
import { getProviderMetadata } from "@ai-usage-profile/shared";
import { CodexProvider, CodexAppServerClient } from "../src/codex.js";

const fixture = fileURLToPath(new URL("../test-support/fake-app-server.js", import.meta.url));

describe("Codex provider", () => {
  it("exposes provider metadata", () => {
    expect(getProviderMetadata("codex").id).toBe("codex");
    expect(() => getProviderMetadata("unknown")).toThrow(/Unknown provider/);
  });

  it("converts App Server data to the shared snapshot", async () => {
    const snapshot = await new CodexProvider({
      clientOptions: { binary: process.execPath, args: [fixture], timeoutMs: 2_000 },
    }).fetch();
    expect(snapshot.provider).toEqual({
      id: "codex",
      name: "Codex",
      source: "OpenAI Codex App Server",
    });
    expect(snapshot.account.plan).toBe("Pro");
    expect(snapshot.metrics.lifetimeTokens).toBe(5_100_000_000);
    expect(snapshot.daily[0]).toEqual({ date: "2026-08-26", tokens: 976_500_000 });
  });

  it("returns an empty object for unknown App Server methods", async () => {
    const client = new CodexAppServerClient({
      binary: process.execPath,
      args: [fixture],
      timeoutMs: 2_000,
    });
    await client.start();
    try {
      await expect(client.request("unknown/method")).resolves.toEqual({});
    } finally {
      await client.close();
    }
  });

  it("rejects requests before the app-server starts", async () => {
    const client = new CodexAppServerClient({ binary: process.execPath, args: [fixture] });
    await expect(client.request("initialize")).rejects.toThrow(/not running/);
  });
});
