import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getProviderMetadata } from "@ai-usage-profile/shared";
import { CodexProvider, CodexAppServerClient, resolveCodexBinary, DARWIN_CODEX_BUNDLES } from "../src/codex.js";
import { userPathEnvironment } from "../src/local/schedule.js";

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

  it("honors CODEX_BIN and resolves codex from augmented PATH", async () => {
    await expect(resolveCodexBinary({ CODEX_BIN: "/custom/codex" })).resolves.toBe("/custom/codex");

    if (process.platform === "darwin") {
      const bundled =
        DARWIN_CODEX_BUNDLES.find((candidate) => existsSync(candidate)) ?? "codex";
      await expect(resolveCodexBinary({ PATH: "" })).resolves.toBe(bundled);
      return;
    }

    const home = await mkdtemp(path.join(os.tmpdir(), "ai-usage-codex-"));
    const codexPath = path.join(home, ".local", "bin", "codex");
    await mkdir(path.dirname(codexPath), { recursive: true });
    await writeFile(codexPath, "", "utf8");
    await chmod(codexPath, 0o755);
    await expect(resolveCodexBinary({
      HOME: home,
      PATH: userPathEnvironment(home, process.platform, ""),
    })).resolves.toBe(codexPath);

    const emptyHome = await mkdtemp(path.join(os.tmpdir(), "ai-usage-codex-empty-"));
    await expect(resolveCodexBinary({ HOME: emptyHome, PATH: "" })).resolves.toBe("codex");
  });
});
