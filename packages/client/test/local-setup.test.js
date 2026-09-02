import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { schedulePaths, resolveStateDir } from "../src/local/schedule.js";
import { setupLocalSchedule } from "../src/local/setup.js";
import { loadUsageSnapshot } from "../../test-support/helpers.js";

describe("local setup", () => {
  let fixture;

  beforeAll(async () => {
    fixture = await loadUsageSnapshot();
  });

  it("publishes with a GitHub bearer token and schedules publish, not git commits", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "ai-usage-setup-"));
    const calls = [];
    const published = [];
    const result = await setupLocalSchedule({
      home,
      platform: "darwin",
      uid: 501,
      now: () => new Date("2026-09-02T16:00:00.000Z"),
      run: async (command, args) => {
        calls.push([command, args[0]]);
        return { status: 0, stdout: "Logged in using ChatGPT\n", stderr: "" };
      },
      fetchSnapshot: async () => fixture,
      publishSnapshot: async (options) => {
        published.push(options);
        return {
          status: "updated",
          revision: 1,
          receivedAt: "2026-09-02T16:00:00.000Z",
          cardUrl: "https://aiusage.teje.sh/u/moquent/card.svg",
        };
      },
      options: {
        hours: 2,
        identity: false,
        env: { GITHUB_TOKEN: "gho_test_token_for_device_flow" },
        fetch: async () => Response.json({ id: 1, login: "Moquent" }),
      },
    });

    expect(result.username).toBe("Moquent");
    expect(result.cardUrl).toBe("https://aiusage.teje.sh/u/moquent/card.svg");
    expect(result.schedule.kind).toBe("launchd");
    expect(result.snippet).toMatch(/aiusage\.teje\.sh\/u\/moquent\/card\.svg/);
    expect(published[0].token).toBe("gho_test_token_for_device_flow");
    expect(published[0].endpoint).toBe("https://aiusage.teje.sh");

    const stateDir = resolveStateDir(home);
    const credentials = JSON.parse(await readFile(schedulePaths(stateDir).credentialsPath, "utf8"));
    expect(credentials.githubToken).toBe("gho_test_token_for_device_flow");
    const state = JSON.parse(await readFile(schedulePaths(stateDir).schedulePath, "utf8"));
    expect(state.endpoint).toBe("https://aiusage.teje.sh");
    const plist = await readFile(schedulePaths(stateDir).launchAgentPath, "utf8");
    expect(plist).toMatch(/<string>publish<\/string>/);
    expect(plist).not.toMatch(/<string>sync<\/string>|<string>--commit<\/string>|<string>--config<\/string>|gho_test_token/);
    await expect(readFile(schedulePaths(stateDir).configPath)).rejects.toThrow();
    expect(calls.some(([command, subcommand]) => command === "launchctl" && subcommand === "bootstrap")).toBe(true);
  });

  it("uninstalls the local schedule when --remove is requested", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "ai-usage-setup-"));
    const calls = [];
    const result = await setupLocalSchedule({
      home,
      platform: "win32",
      run: async (command, args) => {
        calls.push([command, ...args]);
        return { status: 0, stdout: "", stderr: "" };
      },
      options: { remove: true },
    });
    expect(result.schedule.kind).toBe("schtasks");
    expect(calls[0]).toEqual(expect.arrayContaining(["schtasks", "/Delete"]));
  });

  it("rejects a mismatched --username", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "ai-usage-setup-"));
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
        username: "OtherUser",
        env: { GITHUB_TOKEN: "gho_test_token_for_device_flow" },
        fetch: async () => Response.json({ id: 1, login: "Moquent" }),
      },
    })).rejects.toThrow(/does not match/);
  });
});
