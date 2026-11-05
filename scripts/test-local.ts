import { runDemo } from "./runDemo.js";
import type { IDemoCommand } from "./runDemo.js";
import { runWorktreeDemo } from "./test-worktree.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const extensionPath = resolve(repoRoot, "src/index.ts");

const userArgs = process.argv.slice(2);
const isWorktreeTarget = userArgs[0] === "worktree" || userArgs[0] === "wt";

if (isWorktreeTarget) {
  await runWorktreeDemo(userArgs.slice(1));
} else {
  await runDemo(repoRoot, (directory) => {
    const isPortalTarget = userArgs[0] === "portal" || userArgs[0] === "client-portal";
    const portalMockRepoPath = resolve(directory, "company-b", "client-portal");

    const setup: IDemoCommand[] = [];
    if (isPortalTarget) {
      mkdirSync(portalMockRepoPath, { recursive: true });
      writeFileSync(resolve(portalMockRepoPath, "README.md"), "# Client Portal Mock Repo\n");
      const portalWorkspacePath = resolve(repoRoot, "fixtures/workspaces/company-b/portal");
      setup.push(
        { command: "git", args: ["init"], cwd: portalMockRepoPath },
        {
          command: "git",
          args: ["config", "--local", "pi-workspace.load", portalWorkspacePath],
          cwd: portalMockRepoPath,
        },
      );
    }

    const targetCwd = isPortalTarget ? portalMockRepoPath : repoRoot;
    const forwardedArgs = isPortalTarget ? userArgs.slice(1) : userArgs;

    const defaultPrompt = isPortalTarget
      ? ["What instructions and commands are configured for client-portal?"]
      : [
          "List the workspace instruction layers configured in your system prompt, clearly identifying Layer 1 (organization/shared) and Layer 2 (project-specific).",
        ];

    const hasPositionalPrompt = forwardedArgs.some((arg) => !arg.startsWith("-"));
    const promptArgs = hasPositionalPrompt ? forwardedArgs : [...forwardedArgs, ...defaultPrompt];

    console.log("=== @alexgorbatchev/pi-workspace test:local ===");
    console.log(
      `Target: ${isPortalTarget ? "company-b/client-portal (exact mapping)" : "tools/* (wildcard + project layers)"}`,
    );
    console.log(`Directory: ${targetCwd}`);
    console.log(`Tip: Run 'bun run test:local portal' or 'bun run test:local worktree' to test different scenarios.\n`);

    return {
      setup,
      command: process.execPath,
      args: ["x", "--no-install", "pi", "-e", extensionPath, ...promptArgs],
      cwd: targetCwd,
    };
  });
}
