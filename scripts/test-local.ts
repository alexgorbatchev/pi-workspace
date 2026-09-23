import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const workspacesRoot = join(repoRoot, ".tmp", "test-workspaces");
const orgCommonDir = join(workspacesRoot, "tools", "_common");
const projDir = join(workspacesRoot, "tools", "pi-workspace");

// 1. Prepare sample organization and project workspace assets in .tmp/
mkdirSync(join(orgCommonDir, "prompts"), { recursive: true });
mkdirSync(join(projDir, "prompts"), { recursive: true });

writeFileSync(
  join(orgCommonDir, "APPEND_SYSTEM.md"),
  "Company Guideline: Follow organization security policies and code quality standards.",
);
writeFileSync(join(orgCommonDir, "prompts", "org-audit.md"), "Run an organization-wide compliance and security audit.");

writeFileSync(
  join(projDir, "APPEND_SYSTEM.md"),
  "Project Guideline: Ensure all tests pass with bun test before creating a pull request.",
);
writeFileSync(join(projDir, "prompts", "proj-check.md"), "Check project-specific workspace status and test coverage.");

// 2. Collect user prompt arguments or provide a helpful default
const userArgs = process.argv.slice(2);
const promptArgs =
  userArgs.length > 0 ? userArgs : ["What organization and project instructions are configured in your system prompt?"];

const piProcess = spawnSync("bun", ["x", "pi", "-e", "./src/index.ts", ...promptArgs], {
  cwd: repoRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    PI_WORKSPACES_ROOT: workspacesRoot,
    PI_WORKSPACE_BASE_DIR: resolve(repoRoot, ".."),
  },
});

process.exit(piProcess.status ?? 0);
