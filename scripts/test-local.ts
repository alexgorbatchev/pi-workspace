import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");

// Collect user prompt arguments or provide a helpful default
const userArgs = process.argv.slice(2);
const promptArgs =
  userArgs.length > 0 ? userArgs : ["What organization and project instructions are configured in your system prompt?"];

const piProcess = spawnSync("bun", ["x", "pi", "-e", "./src/index.ts", ...promptArgs], {
  cwd: repoRoot,
  stdio: "inherit",
  env: process.env,
});

process.exit(piProcess.status ?? 0);
