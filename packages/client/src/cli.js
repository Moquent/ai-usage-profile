import { Command, InvalidArgumentError } from "commander";
import os from "node:os";
import packageJson from "../package.json" with { type: "json" };
import { resolvePublicOrigin } from "@ai-usage-profile/shared";
import { CodexProvider } from "./codex.js";
import { resolveGitHubToken, setupLocalSchedule } from "./local/setup.js";
import { resolveStateDir } from "./local/schedule.js";
import { publishProviderSnapshot } from "@ai-usage-profile/shared";

function positiveNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new InvalidArgumentError("must be a positive number");
  return number;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new InvalidArgumentError("must be a non-negative integer");
  return number;
}

function intervalHours(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 24) {
    throw new InvalidArgumentError("must be an integer from 1 to 24");
  }
  return number;
}

export function createProgram() {
  const program = new Command()
    .name("ai-usage-profile")
    .description("Publish account-wide AI usage to a hosted GitHub profile card")
    .version(packageJson.version);

  program.command("setup")
    .description("Sign in with GitHub, publish usage, and install a local refresh schedule")
    .option("--remove", "uninstall the local schedule")
    .option("--hours <hours>", "refresh interval in hours", intervalHours, 2)
    .option("--endpoint <url>", "origin (or AI_USAGE_ENDPOINT)")
    .option("--github-client-id <id>", "GitHub OAuth App client ID (or AI_USAGE_GITHUB_CLIENT_ID)")
    .action(async (options) => {
      const result = await setupLocalSchedule({ options });
      if (options.remove) {
        process.stdout.write(`Removed local ${result.schedule.kind} schedule\n`);
        return;
      }
      process.stdout.write(
        `Installed local ${result.schedule.kind} schedule for ${result.username}\nPublished ${result.published.status} snapshot (revision ${result.published.revision})\n${result.cardUrl}\n\nPreview (browser): ${result.previewUrl}\n\nREADME snippet (paste in profile README — do not open &amp; URLs in the browser):\n${result.snippet}\n`,
      );
    });

  program.command("publish")
    .description("Fetch local Codex usage and publish the snapshot")
    .option("--endpoint <url>", "origin (or AI_USAGE_ENDPOINT)")
    .option("--timeout-seconds <seconds>", "request timeout", positiveNumber, 30)
    .option("--retries <count>", "retry count for transient failures", nonNegativeInteger, 3)
    .action(async (options) => {
      const auth = await resolveGitHubToken({ stateDir: resolveStateDir(os.homedir()) });
      if (!auth) {
        throw new Error("Sign in with GitHub device flow (`ai-usage-profile setup`) or set AI_USAGE_GITHUB_TOKEN");
      }
      const result = await publishProviderSnapshot({
        provider: new CodexProvider(),
        endpoint: resolvePublicOrigin(options.endpoint),
        token: auth.token,
        timeoutMs: options.timeoutSeconds * 1_000,
        retries: options.retries,
      });
      process.stdout.write(
        `Published snapshot (${result.status}, revision ${result.revision})\n${result.cardUrl}\n`,
      );
    });

  return program;
}

export async function runCli(argv = process.argv) {
  await createProgram().parseAsync(argv);
}
