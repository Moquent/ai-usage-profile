import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { escapeXml } from "@ai-usage/shared";

export const SCHEDULE_LABEL = "com.ai-usage-profile.sync";
export const WINDOWS_TASK_NAME = "AI Usage Profile Sync";
export const SYSTEMD_UNIT = "ai-usage-profile.sync";

export function resolveStateDir(home = os.homedir()) {
  return path.join(home, ".ai-usage");
}

export function schedulePaths(stateDir) {
  return {
    stateDir,
    schedulePath: path.join(stateDir, "schedule.json"),
    credentialsPath: path.join(stateDir, "credentials.json"),
    logPath: path.join(stateDir, "sync.log"),
    launchAgentPath: path.join(stateDir, `${SCHEDULE_LABEL}.plist`),
    windowsCommandPath: path.join(stateDir, "sync.cmd"),
    systemdServicePath: path.join(stateDir, `${SYSTEMD_UNIT}.service`),
    systemdTimerPath: path.join(stateDir, `${SYSTEMD_UNIT}.timer`),
  };
}

export function userPathEnvironment(home = os.homedir()) {
  const extra = [path.join(home, "bin"), "/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin"];
  const current = process.env.PATH ?? "";
  return [...new Set([...extra, ...current.split(path.delimiter).filter(Boolean)])].join(path.delimiter);
}

export async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

const CRONTAB_START = "# ai-usage-profile start";
const CRONTAB_END = "# ai-usage-profile end";

export function buildPublishArgv({ nodePath, cliPath }) {
  return [nodePath, cliPath, "publish"];
}

function scheduleEnvironment({ home, endpoint }) {
  return {
    HOME: home,
    PATH: userPathEnvironment(home),
    AI_USAGE_ENDPOINT: endpoint,
  };
}

export function buildLaunchAgentPlist(context) {
  const env = scheduleEnvironment(context);
  const args = buildPublishArgv(context)
    .map((value) => `    <string>${escapeXml(value)}</string>`)
    .join("\n");
  const environment = Object.entries(env)
    .map(([key, value]) => `    <key>${key}</key>\n    <string>${escapeXml(value)}</string>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SCHEDULE_LABEL}</string>
  <key>WorkingDirectory</key>
  <string>${escapeXml(context.workingDirectory)}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>StartInterval</key>
  <integer>${Math.round(context.intervalHours * 3_600)}</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(context.logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(context.logPath)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${environment}
  </dict>
</dict>
</plist>
`;
}

export function buildWindowsCommand(context) {
  const env = scheduleEnvironment(context);
  const command = buildPublishArgv(context).map((value) => `"${value}"`).join(" ");
  return `@echo off\r
set "AI_USAGE_ENDPOINT=${env.AI_USAGE_ENDPOINT}"\r
cd /d "${context.workingDirectory}"\r
${command}\r
`;
}

export function buildSystemdUnits(context) {
  const env = scheduleEnvironment(context);
  const exec = buildPublishArgv(context).map(quoteSystemd).join(" ");
  const service = `[Unit]
Description=AI usage profile snapshot publish

[Service]
Type=oneshot
WorkingDirectory=${context.workingDirectory}
Environment=HOME=${env.HOME}
Environment=PATH=${env.PATH}
Environment=AI_USAGE_ENDPOINT=${env.AI_USAGE_ENDPOINT}
ExecStart=${exec}
StandardOutput=append:${context.logPath}
StandardError=append:${context.logPath}
`;
  const timer = `[Unit]
Description=AI usage profile snapshot publish timer

[Timer]
OnBootSec=5min
OnUnitActiveSec=${context.intervalHours}h
Persistent=true

[Install]
WantedBy=timers.target
`;
  return { service, timer };
}

export function upsertCrontab(existing, entry) {
  const block = `${CRONTAB_START}\n${entry}\n${CRONTAB_END}`;
  if (existing.includes(CRONTAB_START) && existing.includes(CRONTAB_END)) {
    return existing.replace(
      new RegExp(`${CRONTAB_START}[\\s\\S]*?${CRONTAB_END}`),
      block,
    );
  }
  const prefix = existing.trimEnd();
  return `${prefix}${prefix ? "\n\n" : ""}${block}\n`;
}

export function removeCrontabBlock(existing) {
  const next = existing.replace(
    new RegExp(`\n*${CRONTAB_START}[\\s\\S]*?${CRONTAB_END}\n*`),
    "\n",
  ).trim();
  return next ? `${next}\n` : "";
}

export function buildCrontabEntry(context) {
  const hours = Math.max(1, Math.round(context.intervalHours));
  const env = scheduleEnvironment(context);
  const args = buildPublishArgv(context).map(quoteShell).join(" ");
  const command = `cd ${quoteShell(context.workingDirectory)} && ${args} >> ${quoteShell(context.logPath)} 2>&1`;
  return `HOME=${env.HOME}\nPATH=${env.PATH}\nAI_USAGE_ENDPOINT=${env.AI_USAGE_ENDPOINT}\n17 */${hours} * * * ${command}`;
}

export async function installSchedule(options) {
  return adapterFor(options.platform ?? process.platform).install(options);
}

export async function uninstallSchedule(options) {
  return adapterFor(options.platform ?? process.platform).uninstall(options);
}

function adapterFor(platform) {
  if (platform === "darwin") return darwinAdapter;
  if (platform === "win32") return windowsAdapter;
  return linuxAdapter;
}

const darwinAdapter = {
  async install(options) {
    const { launchAgentPath } = pathsOf(options);
    await mkdir(path.dirname(launchAgentPath), { recursive: true });
    await writeFile(launchAgentPath, buildLaunchAgentPlist(scheduleContext(options)), "utf8");
    const domain = `gui/${userId(options)}`;
    await options.run("launchctl", ["bootout", `${domain}/${SCHEDULE_LABEL}`]);
    const loaded = await options.run("launchctl", ["bootstrap", domain, launchAgentPath]);
    if (loaded.status !== 0) {
      throw new Error(`Unable to install macOS schedule: ${loaded.stderr || loaded.stdout}`);
    }
    return { kind: "launchd", path: launchAgentPath };
  },
  async uninstall(options) {
    const { launchAgentPath } = pathsOf(options);
    await options.run("launchctl", ["bootout", `gui/${userId(options)}/${SCHEDULE_LABEL}`]);
    await unlinkIfExists(launchAgentPath);
    return { kind: "launchd", path: launchAgentPath };
  },
};

const windowsAdapter = {
  async install(options) {
    const { windowsCommandPath } = pathsOf(options);
    await mkdir(path.dirname(windowsCommandPath), { recursive: true });
    await writeFile(windowsCommandPath, buildWindowsCommand(scheduleContext(options)), "utf8");
    const hours = Math.max(1, Math.round(options.intervalHours));
    const created = await options.run("schtasks", [
      "/Create",
      "/TN", WINDOWS_TASK_NAME,
      "/TR", windowsCommandPath,
      "/SC", "HOURLY",
      "/MO", String(hours),
      "/F",
      "/RL", "LIMITED",
    ]);
    if (created.status !== 0) {
      throw new Error(`Unable to install Windows schedule: ${created.stderr || created.stdout}`);
    }
    return { kind: "schtasks", path: windowsCommandPath };
  },
  async uninstall(options) {
    const { windowsCommandPath } = pathsOf(options);
    await options.run("schtasks", ["/Delete", "/TN", WINDOWS_TASK_NAME, "/F"]);
    await unlinkIfExists(windowsCommandPath);
    return { kind: "schtasks", path: windowsCommandPath };
  },
};

const linuxAdapter = {
  async install(options) {
    const systemd = await options.run("systemctl", ["--user", "--version"]);
    if (systemd.status === 0) return installSystemd(options);
    return installCrontab(options);
  },
  async uninstall(options) {
    const systemd = await options.run("systemctl", ["--user", "--version"]);
    if (systemd.status === 0) return uninstallSystemd(options);
    return uninstallCrontab(options);
  },
};

async function installSystemd(options) {
  const units = buildSystemdUnits(scheduleContext(options));
  const unitDir = path.join(options.home ?? os.homedir(), ".config", "systemd", "user");
  await mkdir(unitDir, { recursive: true });
  const timerPath = path.join(unitDir, `${SYSTEMD_UNIT}.timer`);
  await writeFile(path.join(unitDir, `${SYSTEMD_UNIT}.service`), units.service, "utf8");
  await writeFile(timerPath, units.timer, "utf8");
  const reload = await options.run("systemctl", ["--user", "daemon-reload"]);
  const enable = await options.run("systemctl", ["--user", "enable", "--now", `${SYSTEMD_UNIT}.timer`]);
  if (reload.status !== 0 || enable.status !== 0) {
    throw new Error(`Unable to install systemd timer: ${enable.stderr || reload.stderr}`);
  }
  return { kind: "systemd", path: timerPath };
}

async function uninstallSystemd(options) {
  await options.run("systemctl", ["--user", "disable", "--now", `${SYSTEMD_UNIT}.timer`]);
  const unitDir = path.join(options.home ?? os.homedir(), ".config", "systemd", "user");
  await unlinkIfExists(path.join(unitDir, `${SYSTEMD_UNIT}.service`));
  await unlinkIfExists(path.join(unitDir, `${SYSTEMD_UNIT}.timer`));
  const { systemdServicePath, systemdTimerPath } = pathsOf(options);
  await unlinkIfExists(systemdServicePath);
  await unlinkIfExists(systemdTimerPath);
  await options.run("systemctl", ["--user", "daemon-reload"]);
  return { kind: "systemd", path: path.join(unitDir, `${SYSTEMD_UNIT}.timer`) };
}

async function installCrontab(options) {
  const listed = await options.run("crontab", ["-l"]);
  const existing = listed.status === 0 ? listed.stdout : "";
  const next = upsertCrontab(existing, buildCrontabEntry(scheduleContext(options)));
  const written = await options.run("crontab", ["-"], { input: next });
  if (written.status !== 0) {
    throw new Error(`Unable to install crontab: ${written.stderr || written.stdout}`);
  }
  return { kind: "crontab", path: "crontab" };
}

async function uninstallCrontab(options) {
  const listed = await options.run("crontab", ["-l"]);
  if (listed.status !== 0) return { kind: "crontab", path: "crontab" };
  const next = removeCrontabBlock(listed.stdout);
  const written = await options.run("crontab", ["-"], { input: next });
  if (written.status !== 0) {
    throw new Error(`Unable to remove crontab: ${written.stderr || written.stdout}`);
  }
  return { kind: "crontab", path: "crontab" };
}

function scheduleContext(options) {
  const paths = pathsOf(options);
  return {
    nodePath: options.nodePath,
    cliPath: options.cliPath,
    workingDirectory: options.workingDirectory ?? options.stateDir ?? options.home ?? os.homedir(),
    endpoint: options.endpoint,
    logPath: options.logPath ?? paths.logPath,
    home: options.home ?? os.homedir(),
    intervalHours: options.intervalHours,
  };
}

function pathsOf(options) {
  return schedulePaths(options.stateDir);
}

function userId(options) {
  return options.uid ?? process.getuid?.() ?? 501;
}

function quoteShell(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

function quoteSystemd(value) {
  if (!/[\s"']/u.test(value)) return value;
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

async function unlinkIfExists(filePath) {
  try {
    await unlink(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
