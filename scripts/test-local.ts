import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const extensionPath = resolve(repoRoot, "src/index.ts");
const portalMockRepoPath = resolve(repoRoot, "fixtures/mock-repos/company-b/client-portal");

const userArgs = process.argv.slice(2);
const isPortalTarget = userArgs[0] === "portal" || userArgs[0] === "client-portal";

const targetCwd = isPortalTarget ? portalMockRepoPath : repoRoot;
const forwardedArgs = isPortalTarget ? userArgs.slice(1) : userArgs;

const defaultPrompt = isPortalTarget
  ? ["What instructions and commands are configured for client-portal?"]
  : ["What organization and project instructions are configured in your system prompt?"];

const promptArgs = forwardedArgs.length > 0 ? forwardedArgs : defaultPrompt;

console.log("=== @alexgorbatchev/pi-workspace test:local ===");
console.log(`Target: ${isPortalTarget ? "company-b/client-portal (exact mapping)" : "tools/* (wildcard mapping)"}`);
console.log(`Directory: ${targetCwd}`);
console.log(
  `Tip: Run 'bun run test:local ${isPortalTarget ? "tools" : "portal"}' to test the other mapping scenario.\n`,
);

const piProcess = spawnSync("bun", ["x", "pi", "-e", extensionPath, ...promptArgs], {
  cwd: targetCwd,
  stdio: "inherit",
  env: process.env,
});

process.exit(piProcess.status ?? 0);
