import { jest } from "@jest/globals";
import { captureStdout, loadUsageSnapshot } from "../../test-support/helpers.js";

describe("client CLI behavior", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it("prints setup success output", async () => {
    jest.unstable_mockModule("../src/local/setup.js", () => ({
      resolveGitHubToken: jest.fn(),
      setupLocalSchedule: jest.fn().mockResolvedValue({
        username: "Moquent",
        cardUrl: "https://aiusage.teje.sh/u/moquent/card.svg",
        published: { status: "updated", revision: 2 },
        schedule: { kind: "launchd" },
        snippet: "<img>",
      }),
    }));
    const stdout = captureStdout();
    const { createProgram } = await import("../src/cli.js");
    await createProgram().parseAsync(["setup", "--endpoint", "https://aiusage.teje.sh"], { from: "user" });
    stdout.restore();
    expect(stdout.output()).toMatch(/Installed local launchd schedule for Moquent/);
    expect(stdout.output()).toMatch(/revision 2/);
  });

  it("prints remove output for setup --remove", async () => {
    jest.unstable_mockModule("../src/local/setup.js", () => ({
      resolveGitHubToken: jest.fn(),
      setupLocalSchedule: jest.fn().mockResolvedValue({ schedule: { kind: "launchd" } }),
    }));
    const stdout = captureStdout();
    const { createProgram } = await import("../src/cli.js");
    await createProgram().parseAsync(["setup", "--remove"], { from: "user" });
    stdout.restore();
    expect(stdout.output()).toMatch(/Removed local launchd schedule/);
  });

  it("publishes when credentials are available", async () => {
    const snapshot = await loadUsageSnapshot();
    jest.unstable_mockModule("../src/local/setup.js", () => ({
      resolveGitHubToken: jest.fn().mockResolvedValue({ token: "gho_test_token_long_enough" }),
      setupLocalSchedule: jest.fn(),
    }));
    jest.unstable_mockModule("../src/codex.js", () => ({
      CodexProvider: class CodexProvider {
        async fetch() {
          return snapshot;
        }
      },
    }));
    const stdout = captureStdout();
    const previousFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue(Response.json({
      status: "updated",
      revision: 3,
      receivedAt: "2026-08-30T12:00:00.000Z",
      cardUrl: "https://aiusage.teje.sh/u/moquent/card.svg",
    }));
    try {
      const { createProgram } = await import("../src/cli.js");
      await createProgram().parseAsync(["publish", "--endpoint", "https://aiusage.teje.sh", "--retries", "0"], { from: "user" });
      expect(stdout.output()).toMatch(/Published snapshot \(updated, revision 3\)/);
      expect(global.fetch).toHaveBeenCalled();
    } finally {
      global.fetch = previousFetch;
      stdout.restore();
    }
  });

  it("fails publish when GitHub credentials are missing", async () => {
    jest.unstable_mockModule("../src/local/setup.js", () => ({
      resolveGitHubToken: jest.fn().mockResolvedValue(null),
      setupLocalSchedule: jest.fn(),
    }));
    const { createProgram } = await import("../src/cli.js");
    await expect(
      createProgram().parseAsync(["publish"], { from: "user" }),
    ).rejects.toThrow(/Sign in with GitHub device flow/);
  });
});
