import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { captureStdout, loadUsageSnapshot } from "../../test-support/helpers.js";
import { schedulePaths, resolveStateDir } from "../src/local/schedule.js";
import {
  loginWithDeviceFlow,
  readGitHubCredentials,
  resolveGitHubCredentials,
  runCommand,
  setupLocalSchedule,
} from "../src/local/setup.js";

describe("setup behavior", () => {
  it("returns a non-zero status for missing commands", async () => {
    const result = await runCommand("/nonexistent/path/ai-usage-profile-binary", ["status"]);
    expect(result.status).not.toBe(0);
  });

  it("rejects setup when Codex is not signed in", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "ai-usage-setup-"));
    await expect(setupLocalSchedule({
      home,
      platform: "darwin",
      uid: 501,
      run: async () => ({ status: 1, stdout: "", stderr: "not logged in" }),
      options: {
        env: { GITHUB_TOKEN: "gho_test_token_long_enough" },
        fetch: async () => Response.json({ id: 1, login: "Moquent" }),
      },
    })).rejects.toThrow(/Codex is not signed in/);
  });

  it("rejects device login without a returned token", async () => {
    await expect(loginWithDeviceFlow({
      clientId: "oauth-client-id",
      createAuth: () => async () => ({}),
    })).rejects.toThrow(/did not return a token/);
  });

  it("prints the default device-login verification prompt", async () => {
    const stdout = captureStdout();
    await resolveGitHubCredentials({
      env: { AI_USAGE_GITHUB_CLIENT_ID: "oauth-client-id" },
      createAuth: (options) => async () => {
        await options.onVerification({
          user_code: "ABCD-1234",
          verification_uri: "https://github.com/login/device",
        });
        return { token: "gho_device_token_long_enough" };
      },
      fetch: async () => Response.json({ id: 1, login: "Moquent" }),
    });
    stdout.restore();
    expect(stdout.output()).toMatch(/GitHub device login/);
    expect(stdout.output()).toMatch(/ABCD-1234/);
  });

  it("throws when credentials cannot be resolved", async () => {
    await expect(resolveGitHubCredentials({ env: {} }))
      .rejects.toThrow(/AI_USAGE_GITHUB_CLIENT_ID|Sign in with GitHub device flow/);
  });

  it("rejects unreadable credential files that are not missing", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "ai-usage-setup-"));
    const stateDir = resolveStateDir(home);
    await mkdir(stateDir, { recursive: true });
    await writeFile(schedulePaths(stateDir).credentialsPath, "{not-json", "utf8");
    await expect(readGitHubCredentials(stateDir)).rejects.toThrow();
  });

  it("rejects invalid environment tokens during setup", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "ai-usage-setup-"));
    const fixture = await loadUsageSnapshot();
    await expect(setupLocalSchedule({
      home,
      platform: "darwin",
      uid: 501,
      run: async () => ({ status: 0, stdout: "Logged in using ChatGPT\n", stderr: "" }),
      fetchSnapshot: async () => fixture,
      publishSnapshot: async () => ({
        status: "updated",
        revision: 1,
        receivedAt: "2026-09-02T16:00:00.000Z",
        cardUrl: "https://aiusage.teje.sh/u/moquent/card.svg",
      }),
      options: {
        env: { GITHUB_TOKEN: "gho_invalid_token_value" },
        fetch: async () => new Response("nope", { status: 401 }),
      },
    })).rejects.toThrow(/GITHUB_TOKEN is not a valid GitHub user token/);
  });
});
