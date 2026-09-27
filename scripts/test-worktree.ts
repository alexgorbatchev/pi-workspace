import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const extensionPath = resolve(repoRoot, "src/index.ts");

const testBaseDirectory = resolve(repoRoot, ".tmp", "test-worktree");
const mainRepositoryPath = join(testBaseDirectory, "main-repo");
const worktreeRepositoryPath = join(testBaseDirectory, "feature-worktree");

function setupTestEnvironment(): void {
  rmSync(testBaseDirectory, { recursive: true, force: true });
  mkdirSync(mainRepositoryPath, { recursive: true });

  writeFileSync(join(mainRepositoryPath, "README.md"), "# Main Repository (Worktree Demo)\n");

  spawnSync("git", ["init"], { cwd: mainRepositoryPath });
  spawnSync("git", ["config", "user.name", "Workspace Tester"], { cwd: mainRepositoryPath });
  spawnSync("git", ["config", "user.email", "tester@example.com"], { cwd: mainRepositoryPath });
  spawnSync("git", ["add", "."], { cwd: mainRepositoryPath });
  spawnSync("git", ["commit", "-m", "initial commit"], { cwd: mainRepositoryPath });

  const commonWorkspacePath = resolve(repoRoot, "fixtures/workspaces/tools/_common");
  const projectWorkspacePath = resolve(repoRoot, "fixtures/workspaces/tools/pi-workspace");

  spawnSync("git", ["config", "--local", "--add", "pi-workspace.load", commonWorkspacePath], {
    cwd: mainRepositoryPath,
  });
  spawnSync("git", ["config", "--local", "--add", "pi-workspace.load", projectWorkspacePath], {
    cwd: mainRepositoryPath,
  });

  spawnSync("git", ["worktree", "add", worktreeRepositoryPath, "-b", "feature/worktree-test"], {
    cwd: mainRepositoryPath,
  });
}

if (!existsSync(join(mainRepositoryPath, ".git")) || !existsSync(join(worktreeRepositoryPath, ".git"))) {
  setupTestEnvironment();
}

const userArguments = process.argv.slice(2);
const isMainTarget = userArguments[0] === "main";
const forwardedArguments = isMainTarget ? userArguments.slice(1) : userArguments;

const targetCurrentDirectory = isMainTarget ? mainRepositoryPath : worktreeRepositoryPath;

const defaultPrompt = [
  "Verify and display your current working directory (cwd) and list the workspace instruction layers configured in your system prompt.",
];

const hasPositionalPrompt = forwardedArguments.some((argument) => !argument.startsWith("-"));
const promptArguments = hasPositionalPrompt ? forwardedArguments : [...forwardedArguments, ...defaultPrompt];

console.log("=== @alexgorbatchev/pi-workspace test:worktree ===");
console.log(`Target: ${isMainTarget ? "Main Repository" : "Linked Git Worktree"}`);
console.log(`Working Directory: ${targetCurrentDirectory}`);
console.log(`Main Repo: ${mainRepositoryPath}`);
console.log(`Worktree Repo: ${worktreeRepositoryPath}`);
console.log("Git Config (pi-workspace.load):");
console.log("  - fixtures/workspaces/tools/_common");
console.log("  - fixtures/workspaces/tools/pi-workspace");
console.log(
  `Tip: Run 'bun run test:worktree ${isMainTarget ? "worktree" : "main"}' to switch between worktree and main repository.\n`,
);

const piProcess = spawnSync("bun", ["x", "pi", "-e", extensionPath, ...promptArguments], {
  cwd: targetCurrentDirectory,
  stdio: "inherit",
  env: process.env,
});

process.exit(piProcess.status ?? 0);
