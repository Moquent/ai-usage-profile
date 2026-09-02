#!/usr/bin/env node

import { runCli } from "../src/cli.js";

runCli().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
