import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  SCHEDULE_LABEL,
  WINDOWS_TASK_NAME,
  resolveStateDir,
  schedulePaths,
  buildCrontabEntry,
  buildLaunchAgentPlist,
  buildSystemdUnits,
  buildWindowsCommand,
  installSchedule,
  removeCrontabBlock,
  uninstallSchedule,
  upsertCrontab,
  userPathEnvironment,
} from "../src/local/schedule.js";

const scheduleContext = {
  nodePath: "/usr/local/bin/node",
  cliPath: "/opt/ai-usage-profile/bin/ai-usage-profile.js",
  workingDirectory: "/home/user/.ai-usage",
  endpoint: "https://aiusage.teje.sh",
  logPath: "/home/user/.ai-usage/sync.log",
  intervalHours: 2,
};

describe("local schedule", () => {
  it("builds launch agent, systemd, and Windows commands that invoke publish", () => {
    const plist = buildLaunchAgentPlist({ ...scheduleContext, home: "/home/user" });
    expect(plist).toMatch(new RegExp(`<string>${SCHEDULE_LABEL}</string>`));
    expect(plist).toMatch(/<string>publish<\/string>/);
    expect(plist).not.toMatch(/<string>sync<\/string>|<string>--commit<\/string>|<string>--config<\/string>/);
    expect(plist).toMatch(/<key>StartInterval<\/key>\s*<integer>7200<\/integer>/s);
    expect(plist).toMatch(/<string>\/home\/user\/.ai-usage<\/string>/);
    expect(plist).toMatch(/<string>https:\/\/aiusage\.teje\.sh<\/string>/);

    const windows = buildWindowsCommand({ ...scheduleContext, home: "/home/user" });
    expect(windows).toMatch(/set "USERPROFILE=\/home\/user"/);
    expect(windows).toMatch(/set "PATH=/);
    expect(windows).toMatch(/%PATH%/);
    expect(windows).toMatch(/cd \/d "\/home\/user\/\.ai-usage"/);
    expect(windows).toMatch(/"\/usr\/local\/bin\/node".*"publish"/);
    expect(windows).not.toMatch(/--config/);

    const { service, timer } = buildSystemdUnits({ ...scheduleContext, home: "/home/user" });
    expect(service).toMatch(/WorkingDirectory=\/home\/user\/\.ai-usage/);
    expect(service).toMatch(/ExecStart=\/usr\/local\/bin\/node .* publish$/m);
    expect(service).not.toMatch(/--config/);
    expect(timer).toMatch(/OnUnitActiveSec=2h/);
  });

  it("upserts and removes only the managed crontab block", () => {
    const entry = buildCrontabEntry({ ...scheduleContext, home: "/home/user" });
    expect(entry).toMatch(/^HOME=\/home\/user$/m);
    expect(entry).toMatch(/17 \*\/2 \* \* \*/);
    const first = upsertCrontab("# keep\n0 * * * * echo other\n", entry);
    const second = upsertCrontab(first, entry.replace("*/2", "*/3"));
    expect((second.match(/# ai-usage-profile start/g) ?? []).length).toBe(1);
    expect(second).toMatch(/echo other/);
    expect(second).toMatch(/17 \*\/3 \* \* \*/);
    expect(removeCrontabBlock(second).includes("ai-usage-profile")).toBe(false);
    expect(removeCrontabBlock(second)).toMatch(/echo other/);
  });

  it("adds platform-specific PATH entries for scheduled publish", () => {
    const linuxPath = userPathEnvironment("/home/user", "linux");
    expect(linuxPath.split(":")).toEqual(
      expect.arrayContaining(["/home/user/.local/bin", "/usr/local/bin", "/opt/homebrew/bin"]),
    );

    const windowsPath = userPathEnvironment("C:\\Users\\alice", "win32");
    expect(windowsPath.split(";")).toEqual(
      expect.arrayContaining([
        "C:\\Users\\alice\\bin",
        "C:\\Users\\alice\\AppData\\Roaming\\npm",
        "C:\\Users\\alice\\AppData\\Local\\Programs",
        "C:\\Users\\alice\\AppData\\Local\\Programs\\codex",
        "C:\\Users\\alice\\AppData\\Local\\Microsoft\\WindowsApps",
      ]),
    );
  });

  it("installs a launch agent on macOS", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "ai-usage-schedule-"));
    const stateDir = resolveStateDir(home);
    const calls = [];
    const installed = await installSchedule({
      platform: "darwin",
      uid: 501,
      stateDir,
      run: async (command, args) => {
        calls.push([command, ...args]);
        return { status: 0, stdout: "", stderr: "" };
      },
      ...scheduleContext,
      home,
      workingDirectory: stateDir,
    });
    const plist = await readFile(schedulePaths(stateDir).launchAgentPath, "utf8");
    expect(installed.kind).toBe("launchd");
    expect(plist).toMatch(/StartInterval/);
    expect(calls.at(-1)).toEqual([
      "launchctl",
      "bootstrap",
      "gui/501",
      schedulePaths(stateDir).launchAgentPath,
    ]);
  });

  it("installs systemd units on Linux", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "ai-usage-schedule-"));
    const stateDir = resolveStateDir(home);
    const calls = [];
    const installed = await installSchedule({
      platform: "linux",
      stateDir,
      run: async (command, args) => {
        calls.push([command, ...args]);
        return { status: 0, stdout: "", stderr: "" };
      },
      ...scheduleContext,
      home,
      workingDirectory: stateDir,
    });
    expect(installed.kind).toBe("systemd");
    expect(calls.some(([command]) => command === "systemctl")).toBe(true);
    const servicePath = path.join(home, ".config", "systemd", "user", "ai-usage-profile.sync.service");
    await expect(readFile(servicePath, "utf8")).resolves.toMatch(/publish/);
  });

  it("falls back to cron when systemd is unavailable", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "ai-usage-schedule-"));
    const stateDir = resolveStateDir(home);
    const installed = await installSchedule({
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
    expect(installed.kind).toBe("crontab");
  });

  it("uninstalls Windows scheduled tasks", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "ai-usage-schedule-"));
    const stateDir = resolveStateDir(home);
    await mkdir(stateDir, { recursive: true });
    const calls = [];
    const removed = await uninstallSchedule({
      platform: "win32",
      stateDir,
      run: async (command, args) => {
        calls.push([command, ...args]);
        return { status: 0, stdout: "", stderr: "" };
      },
      ...scheduleContext,
      home,
      workingDirectory: stateDir,
    });
    expect(removed.kind).toBe("schtasks");
    expect(calls[0]).toEqual(["schtasks", "/Delete", "/TN", WINDOWS_TASK_NAME, "/F"]);
  });
});
