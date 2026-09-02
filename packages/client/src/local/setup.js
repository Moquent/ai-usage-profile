import { chmod } from "node:fs/promises";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createOAuthDeviceAuth } from "@octokit/auth-oauth-device";
import { execa } from "execa";
import { publicCardUrl, publishProviderSnapshot, resolvePublicOrigin, verifyGitHubUser, DEFAULT_GITHUB_OAUTH_CLIENT_ID } from "@ai-usage/shared";
import { CodexProvider, resolveCodexBinary } from "../codex.js";
import { installSchedule, uninstallSchedule, resolveStateDir, schedulePaths, readJson, writeJson } from "./schedule.js";

export const GITHUB_OAUTH_CLIENT_TYPE = "oauth-app";
export const GITHUB_OAUTH_SCOPES = Object.freeze([]);

export function resolveGitHubClientId(clientId, env = process.env) {
  return clientId || env.AI_USAGE_GITHUB_CLIENT_ID || DEFAULT_GITHUB_OAUTH_CLIENT_ID;
}

export async function runCommand(command, args, { cwd, env, timeout = 120_000, input } = {}) {
  try {
    const result = await execa(command, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      timeout,
      input,
      reject: false,
      windowsHide: true,
    });
    return { status: result.exitCode ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  } catch (error) {
    if (error.code === "ENOENT") return { status: 127, stdout: "", stderr: error.message };
    throw error;
  }
}

export async function readGitHubCredentials(stateDir) {
  try {
    const payload = await readJson(schedulePaths(stateDir).credentialsPath);
    return typeof payload.githubToken === "string" && payload.githubToken.length > 0 ? payload : null;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function writeGitHubCredentials(stateDir, credentials) {
  const filePath = schedulePaths(stateDir).credentialsPath;
  await writeJson(filePath, credentials);
  await chmod(filePath, 0o600);
  return filePath;
}

export async function loginWithDeviceFlow({
  clientId,
  onVerification,
  createAuth = createOAuthDeviceAuth,
}) {
  const resolvedClientId = resolveGitHubClientId(clientId);
  const auth = createAuth({
    clientType: GITHUB_OAUTH_CLIENT_TYPE,
    clientId: resolvedClientId,
    scopes: [...GITHUB_OAUTH_SCOPES],
    onVerification,
  });
  const authentication = await auth({ type: "oauth", refresh: true });
  if (typeof authentication?.token !== "string" || authentication.token.length === 0) {
    throw new Error("GitHub device login did not return a token");
  }
  return authentication.token;
}

export async function resolveGitHubToken(options = {}) {
  const auth = await resolveGitHubAuth(options);
  return auth ? { token: auth.githubToken, username: auth.username, githubUserId: auth.githubUserId } : null;
}

export async function resolveGitHubCredentials(options = {}) {
  const auth = await resolveGitHubAuth({ ...options, allowDeviceLogin: true });
  if (!auth) {
    throw new Error("Sign in with GitHub device flow (`ai-usage-profile setup`) or set AI_USAGE_GITHUB_TOKEN");
  }
  return auth;
}

export async function setupLocalSchedule({
  options,
  now = () => new Date(),
  run = runCommand,
  home = os.homedir(),
  platform = process.platform,
  uid,
  fetchSnapshot,
  publishSnapshot = publishProviderSnapshot,
} = {}) {
  if (options.remove) {
    const removed = await uninstallSchedule({ platform, uid, run, home, stateDir: resolveStateDir(home) });
    return { schedule: removed };
  }

  const stateDir = resolveStateDir(home);
  const paths = schedulePaths(stateDir);
  await requireCodexLogin({ run });
  const github = await resolveGitHubCredentials({
    clientId: options.githubClientId ?? process.env.AI_USAGE_GITHUB_CLIENT_ID,
    env: options.env ?? process.env,
    stateDir,
    fetch: options.fetch,
    createAuth: options.createGitHubAuth,
    onVerification: options.onGitHubVerification,
  });
  if (options.username && options.username.toLowerCase() !== github.username.toLowerCase()) {
    throw new Error(
      `--username ${options.username} does not match the signed-in GitHub account ${github.username}`,
    );
  }

  await writeGitHubCredentials(stateDir, {
    githubToken: github.githubToken,
    username: github.username,
    githubUserId: github.githubUserId,
    source: github.source,
  });

  const endpoint = resolvePublicOrigin(options.endpoint, options.env ?? process.env);
  const published = await publishSnapshot({
    provider: fetchSnapshot ? { fetch: fetchSnapshot } : new CodexProvider(),
    endpoint,
    token: github.githubToken,
  });

  const intervalHours = options.hours ?? 2;
  const cliPath = fileURLToPath(new URL("../../bin/ai-usage-profile.js", import.meta.url));
  const installed = await installSchedule({
    platform,
    uid,
    run,
    home,
    stateDir,
    workingDirectory: stateDir,
    endpoint,
    nodePath: process.execPath,
    cliPath,
    logPath: paths.logPath,
    intervalHours,
  });
  await writeJson(paths.schedulePath, {
    endpoint,
    workingDirectory: stateDir,
    nodePath: process.execPath,
    cliPath,
    intervalHours,
    kind: installed.kind,
    installedAt: now().toISOString(),
  });

  const cardUrl = publicCardUrl(endpoint, github.username);
  return {
    username: github.username,
    endpoint,
    cardUrl: published.cardUrl,
    published,
    schedule: installed,
    snippet: `<picture>
  <source media="(prefers-color-scheme: dark)" srcset="${cardUrl}?theme=dark">
  <source media="(prefers-color-scheme: light)" srcset="${cardUrl}?theme=light">
  <img width="100%" src="${cardUrl}?theme=dark" alt="Account-wide AI usage">
</picture>`,
  };
}

async function resolveGitHubAuth({
  fetch: fetchImpl = fetch,
  env = process.env,
  stateDir,
  clientId,
  onVerification = defaultOnVerification,
  createAuth = createOAuthDeviceAuth,
  allowDeviceLogin = false,
} = {}) {
  const envToken = env.AI_USAGE_GITHUB_TOKEN || env.GITHUB_TOKEN;
  if (envToken) {
    const user = await requireGitHubUser(envToken, fetchImpl, "GITHUB_TOKEN is not a valid GitHub user token");
    return { githubToken: envToken, username: user.login, githubUserId: user.id, source: "env" };
  }

  if (stateDir) {
    const stored = await readGitHubCredentials(stateDir);
    if (stored?.githubToken) {
      const user = await verifyGitHubUser(stored.githubToken, { fetch: fetchImpl });
      if (user) {
        return {
          githubToken: stored.githubToken,
          username: user.login,
          githubUserId: user.id,
          source: "file",
        };
      }
    }
  }

  if (!allowDeviceLogin) return null;
  const githubToken = await loginWithDeviceFlow({
    clientId: resolveGitHubClientId(clientId, env),
    onVerification,
    createAuth,
  });
  const user = await requireGitHubUser(githubToken, fetchImpl, "GitHub device login did not return a valid user");
  return { githubToken, username: user.login, githubUserId: user.id, source: "device" };
}

async function requireGitHubUser(token, fetchImpl, message) {
  const user = await verifyGitHubUser(token, { fetch: fetchImpl });
  if (!user) throw new Error(message);
  return user;
}

async function requireCodexLogin({ run, resolveBinary = resolveCodexBinary } = {}) {
  const binary = await resolveBinary();
  const result = await run(binary, ["login", "status"]);
  const output = `${result.stdout}\n${result.stderr}`;
  if (result.status !== 0 || !/logged in/i.test(output)) {
    throw new Error("Codex is not signed in. Run `codex login` or sign in through the ChatGPT desktop app, then retry.");
  }
}

function defaultOnVerification(verification) {
  process.stdout.write(
    [
      "GitHub device login",
      `  Open: ${verification.verification_uri}`,
      `  Code: ${verification.user_code}`,
      "",
    ].join("\n"),
  );
}
