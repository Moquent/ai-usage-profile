import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildLaunchAgentPlist,
  installSchedule,
  resolveStateDir,
  uninstallSchedule,
} from "../src/local/schedule.js";

const scheduleContext = {
  nodePath: "/usr/local/bin/node",
  cliPath: "/opt/ai-usage-profile/bin/ai-usage-profile.js",
  workingDirectory: "/home/user/.ai-usage",
  endpoint: "https://aiusage.teje.sh",
  logPath: "/home/user/.ai-usage/sync.log",
  intervalHours: 2,
};

describe("schedule failures and uninstall paths", () => {
  it("escapes special characters in launch agent plists", () => {
    const plist = buildLaunchAgentPlist({
      ...scheduleContext,
      home: "/home/user",
      workingDirectory: `/tmp/user's "profile"`,
      logPath: `/tmp/user's "profile"/sync.log`,
    });
    expect(plist).toMatch(/user&apos;s &quot;profile&quot;/);
  });

  it("surfaces launchd bootstrap failures", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "ai-usage-schedule-"));
    const stateDir = resolveStateDir(home);
    await expect(installSchedule({
      platform: "darwin",
      uid: 501,
      stateDir,
      run: async (command) => {
        if (command === "launchctl") return { status: 1, stdout: "", stderr: "bootstrap failed" };
        return { status: 0, stdout: "", stderr: "" };
      },
      ...scheduleContext,
      home,
      workingDirectory: stateDir,
    })).rejects.toThrow(/Unable to install macOS schedule/);
  });

  it("surfaces Windows scheduler failures", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "ai-usage-schedule-"));
    const stateDir = resolveStateDir(home);
    await expect(installSchedule({
      platform: "win32",
      stateDir,
      run: async (command) => {
        if (command === "schtasks") return { status: 1, stdout: "", stderr: "access denied" };
        return { status: 0, stdout: "", stderr: "" };
      },
      ...scheduleContext,
      home,
      workingDirectory: stateDir,
    })).rejects.toThrow(/Unable to install Windows schedule/);
  });

  it("surfaces systemd install failures", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "ai-usage-schedule-"));
    const stateDir = resolveStateDir(home);
    await expect(installSchedule({
      platform: "linux",
      stateDir,
      run: async (command, args) => {
        if (command === "systemctl" && args.includes("enable")) {
          return { status: 1, stdout: "", stderr: "failed to enable timer" };
        }
        return { status: 0, stdout: "", stderr: "" };
      },
      ...scheduleContext,
      home,
      workingDirectory: stateDir,
    })).rejects.toThrow(/Unable to install systemd timer/);
  });

  it("uninstalls launchd schedules", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "ai-usage-schedule-"));
    const stateDir = resolveStateDir(home);
    const removed = await uninstallSchedule({
      platform: "darwin",
      uid: 501,
      stateDir,
      run: async () => ({ status: 0, stdout: "", stderr: "" }),
      ...scheduleContext,
      home,
      workingDirectory: stateDir,
    });
    expect(removed.kind).toBe("launchd");
  });

  it("uninstalls systemd schedules", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "ai-usage-schedule-"));
    const stateDir = resolveStateDir(home);
    const removed = await uninstallSchedule({
      platform: "linux",
      stateDir,
      run: async () => ({ status: 0, stdout: "", stderr: "" }),
      ...scheduleContext,
      home,
      workingDirectory: stateDir,
    });
    expect(removed.kind).toBe("systemd");
  });

  it("uninstalls cron schedules when systemd is unavailable", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "ai-usage-schedule-"));
    const stateDir = resolveStateDir(home);
    const removed = await uninstallSchedule({
      platform: "linux",
      stateDir,
      run: async (command, args) => {
        if (command === "systemctl") return { status: 127, stdout: "", stderr: "not found" };
        if (command === "crontab" && args[0] === "-l") return { status: 1, stdout: "", stderr: "" };
        return { status: 0, stdout: "", stderr: "" };
      },
      ...scheduleContext,
      home,
      workingDirectory: stateDir,
    });
    expect(removed.kind).toBe("crontab");
  });
});
