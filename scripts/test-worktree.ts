import { runDemo } from "./runDemo.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const extensionPath = resolve(repoRoot, "src/index.ts");

export async function runWorktreeDemo(userArguments: string[]): Promise<void> {
  await runDemo(repoRoot, (testBaseDirectory) => {
    const mainRepositoryPath = join(testBaseDirectory, "main-repo");
    const worktreeRepositoryPath = join(testBaseDirectory, "feature-worktree");
    mkdirSync(mainRepositoryPath, { recursive: true });

    writeFileSync(join(mainRepositoryPath, "README.md"), "# Main Repository (Worktree Demo)\n");

    const commonWorkspacePath = resolve(repoRoot, "fixtures/workspaces/tools/_common");
    const projectWorkspacePath = resolve(repoRoot, "fixtures/workspaces/tools/pi-workspace");
    const setup = [
      ["init"],
      ["config", "user.name", "Workspace Tester"],
      ["config", "user.email", "tester@example.com"],
      ["add", "."],
      ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "commit", "-m", "initial commit"],
      ["config", "--local", "--add", "pi-workspace.load", commonWorkspacePath],
      ["config", "--local", "--add", "pi-workspace.load", projectWorkspacePath],
      ["worktree", "add", worktreeRepositoryPath, "-b", "feature/worktree-test"],
    ].map((args) => ({ command: "git", args, cwd: mainRepositoryPath }));
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

    return {
      setup,
      command: process.execPath,
      args: ["x", "--no-install", "pi", "-e", extensionPath, ...promptArguments],
      cwd: targetCurrentDirectory,
    };
  });
}

if (import.meta.main) {
  await runWorktreeDemo(process.argv.slice(2));
}
