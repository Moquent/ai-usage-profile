import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import readline from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { JSONRPCClient } from "json-rpc-2.0";
import { PROVIDER_CATALOG, parseUsageSnapshot } from "@ai-usage-profile/shared";
import packageJson from "../package.json" with { type: "json" };

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_ARGS = Object.freeze(["app-server", "--stdio"]);

const PLAN_LABELS = Object.freeze({
  free: "Free",
  go: "Go",
  plus: "Plus",
  pro: "Pro",
  prolite: "Pro Lite",
  team: "Team",
  business: "Business",
  enterprise: "Enterprise",
  edu: "Edu",
  edu_plus: "Edu Plus",
  edu_pro: "Edu Pro",
});

export async function resolveCodexBinary(environment = process.env) {
  if (environment.CODEX_BIN) return environment.CODEX_BIN;
  const candidates = process.platform === "darwin"
    ? [
        "/Applications/ChatGPT.app/Contents/Resources/codex",
        "/Applications/Codex.app/Contents/Resources/codex",
      ]
    : [];
  return candidates.find((candidate) => existsSync(candidate)) ?? "codex";
}

export class CodexAppServerClient {
  constructor({ binary, args = DEFAULT_ARGS, timeoutMs = DEFAULT_TIMEOUT_MS, environment } = {}) {
    this.binary = binary;
    this.args = args;
    this.timeoutMs = timeoutMs;
    this.environment = environment ?? process.env;
    this.process = null;
    this.exitPromise = null;
    this.stderrTail = [];
    this.closing = false;
  }

  async start() {
    if (this.process) return;
    const binary = this.binary ?? (await resolveCodexBinary(this.environment));
    const subprocess = spawn(binary, this.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: this.environment,
    });
    this.process = subprocess;
    this.rpc = new JSONRPCClient((payload) => this.#send(payload));
    this.stdoutLines = readline.createInterface({ input: subprocess.stdout });
    this.stdoutLines.on("line", (line) => this.#receive(line));
    this.stderrLines = readline.createInterface({ input: subprocess.stderr });
    this.stderrLines.on("line", (line) => {
      this.stderrTail.push(line);
      if (this.stderrTail.length > 12) this.stderrTail.shift();
    });
    this.exitPromise = new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        if (!this.closing) this.rpc.rejectAllPendingRequests(this.#exitMessage(result));
        resolve(result);
      };
      subprocess.once("error", (error) => finish({ error, exitCode: null, signal: null }));
      subprocess.once("exit", (exitCode, signal) => finish({ error: null, exitCode, signal }));
    });
    await this.request("initialize", {
      clientInfo: { name: "ai_usage_profile", title: "AI Usage Profile", version: packageJson.version },
      capabilities: {},
    });
    this.notify("initialized", {});
  }

  async request(method, params) {
    if (!this.rpc) throw new Error("Codex app-server is not running");
    try {
      return await this.rpc.timeout(this.timeoutMs).request(method, params);
    } catch (error) {
      throw new Error(`${method} failed: ${error.message}`, { cause: error });
    }
  }

  notify(method, params) {
    if (!this.rpc) throw new Error("Codex app-server is not running");
    this.rpc.notify(method, params);
  }

  async close() {
    const subprocess = this.process;
    if (!subprocess) return;
    this.process = null;
    this.closing = true;
    this.stdoutLines?.close();
    this.stderrLines?.close();
    subprocess.stdin.end();
    await Promise.race([this.exitPromise, delay(500)]);
    if (subprocess.exitCode === null) subprocess.kill("SIGTERM");
    await this.exitPromise;
  }

  #send(payload) {
    if (!this.process?.stdin.writable) {
      return Promise.reject(new Error("Codex app-server stdin is not writable"));
    }
    const wireMessage = { ...payload };
    delete wireMessage.jsonrpc;
    return new Promise((resolve, reject) => {
      this.process.stdin.write(`${JSON.stringify(wireMessage)}\n`, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  #receive(line) {
    try {
      const message = JSON.parse(line);
      if (message.id !== undefined && (message.result !== undefined || message.error)) {
        this.rpc.receive(message);
      }
    } catch {
      // Ignore non-protocol stdout.
    }
  }

  #exitMessage(result) {
    const detail = this.stderrTail.join("\n").trim();
    const status = result.error
      ? `Codex app-server failed to start: ${result.error.message}`
      : `Codex app-server exited (code=${result.exitCode}, signal=${result.signal})`;
    return detail ? `${status}: ${detail}` : status;
  }
}

export class CodexProvider {
  constructor({
    clientOptions = {},
    clientFactory = (options) => new CodexAppServerClient(options),
    metadata = PROVIDER_CATALOG.codex,
  } = {}) {
    this.metadata = Object.freeze({ ...metadata });
    this.clientOptions = clientOptions;
    this.clientFactory = clientFactory;
  }

  async fetch() {
    const client = this.clientFactory(this.clientOptions);
    await client.start();
    try {
      const accountPayload = await client.request("account/read", { refreshToken: true });
      const account = accountPayload?.account ?? null;
      if (account !== null && typeof account?.type !== "string") {
        throw new Error("Codex account/read returned an invalid account payload");
      }
      if (!account) {
        throw new Error(
          "Codex is not signed in. Run `codex login` or sign in through the ChatGPT desktop app, then retry.",
        );
      }
      if (account.type === "apiKey" || account.type === "amazonBedrock") {
        throw new Error(
          "Account-wide usage requires ChatGPT-backed Codex authentication; API-key and Bedrock authentication are not supported.",
        );
      }
      const usagePayload = await client.request("account/usage/read");
      const summary = usagePayload?.summary;
      if (!summary || typeof summary !== "object") {
        throw new Error("Codex account/usage/read returned an invalid summary");
      }
      return parseUsageSnapshot({
        provider: this.metadata,
        account: { plan: PLAN_LABELS[account.planType] ?? account.planType ?? null },
        metrics: {
          lifetimeTokens: summary.lifetimeTokens ?? null,
          peakDailyTokens: summary.peakDailyTokens ?? null,
          longestRunningTurnSec: summary.longestRunningTurnSec ?? null,
          currentStreakDays: summary.currentStreakDays ?? null,
          longestStreakDays: summary.longestStreakDays ?? null,
        },
        daily: (usagePayload.dailyUsageBuckets ?? []).map(({ startDate, tokens }) => ({
          date: startDate,
          tokens,
        })),
      });
    } finally {
      await client.close();
    }
  }
}
