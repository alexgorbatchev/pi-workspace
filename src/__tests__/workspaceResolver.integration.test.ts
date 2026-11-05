import { expect, test, spyOn, onTestFinished } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  findMainRepositoryRoot,
  loadGitWorkspaceConfig,
  parseGitConfigLoads,
  parseWorkspaceConfig,
  readGitConfigLoads,
  readPromptFile,
  readSettingsFile,
  resolveGitConfigPath,
  scanDirectoryAssets,
  getWorkspaceResourcePaths,
} from "../workspaceResolver.js";
import { createTestDirectory } from "./fixtures/index.js";

function git(repository: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: repository, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function createRepository(): string {
  const repository = createTestDirectory();
  git(repository, "init", "--initial-branch=main");
  return repository;
}

test.each(["config", "load", "path"])("reads repeated and comma-separated %s values through real Git", (key) => {
  const repository = createRepository();
  git(repository, "config", "--local", "--add", `pi-workspace.${key}`, "./first, ./second");
  git(repository, "config", "--local", "--add", `pi-workspace.${key}`, "./third");
  expect(readGitConfigLoads(repository)).toEqual(["./first", "./second", "./third"]);
  expect(resolveGitConfigPath(repository)).toBe(join(repository, ".git/config"));
});

test("resolves JSON configuration relative to its file and prioritizes config over load", () => {
  const repository = createRepository();
  mkdirSync(join(repository, "settings"));
  writeFileSync(
    join(repository, "settings/workspace.json"),
    JSON.stringify({ configs: [{ when: repository, load: ["./first", "./second"] }] }),
  );
  git(repository, "config", "--local", "pi-workspace.config", "./settings/workspace.json");
  git(repository, "config", "--local", "pi-workspace.load", "./ignored");
  expect(loadGitWorkspaceConfig(repository)).toEqual({
    configs: [{ when: repository, load: [join(repository, "settings/first"), join(repository, "settings/second")] }],
    gitConfigValue: join(repository, "settings/workspace.json"),
  });
});

test("reads worktree-specific configuration and resolves its native Git config path", () => {
  const root = createTestDirectory();
  const main = join(root, "main");
  const worktree = join(root, "worktree");
  mkdirSync(main);
  git(main, "init", "--initial-branch=main");
  git(
    main,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.com",
    "-c",
    "commit.gpgsign=false",
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "--allow-empty",
    "-m",
    "Fixture",
  );
  git(main, "config", "extensions.worktreeConfig", "true");
  git(main, "worktree", "add", "-b", "fixture", worktree);
  git(worktree, "config", "--worktree", "pi-workspace.load", "./worktree-assets");
  expect(findMainRepositoryRoot(worktree)).toBe(main);
  expect(resolveGitConfigPath(worktree)).toBe(join(main, ".git/worktrees/worktree/config.worktree"));
  expect(readGitConfigLoads(worktree)).toEqual(["./worktree-assets"]);
});

test("falls back to a linked worktree config when Git cannot read an incomplete fixture repository", () => {
  const root = createTestDirectory();
  const worktree = join(root, "worktree");
  const gitDirectory = join(root, "main/.git/worktrees/worktree");
  mkdirSync(worktree);
  mkdirSync(gitDirectory, { recursive: true });
  writeFileSync(join(worktree, ".git"), `gitdir: ${gitDirectory}\n`);
  writeFileSync(join(gitDirectory, "commondir"), "../..\n");
  writeFileSync(join(gitDirectory, "config.worktree"), "[pi-workspace]\nload = ./assets\n");
  expect(readGitConfigLoads(worktree)).toEqual(["./assets"]);
  expect(resolveGitConfigPath(worktree)).toBe(join(gitDirectory, "config.worktree"));
});

test("scans native asset directories and ignores unsupported files", () => {
  const root = createTestDirectory();
  mkdirSync(join(root, "skills/review"), { recursive: true });
  mkdirSync(join(root, "prompts"));
  mkdirSync(join(root, "extensions"));
  writeFileSync(join(root, "skills/review/SKILL.md"), "Review instructions.");
  writeFileSync(join(root, "prompts/review.md"), "Review prompt.");
  writeFileSync(join(root, "extensions/review.js"), "export default () => {};");
  writeFileSync(join(root, "extensions/review.test.ts"), "");
  expect(scanDirectoryAssets(root)).toEqual({
    skillNames: ["review"],
    promptNames: ["review"],
    extensionFileNames: ["review.js"],
  });
  expect(getWorkspaceResourcePaths([root, root])).toEqual({
    skillPaths: [join(root, "skills")],
    promptPaths: [join(root, "prompts")],
    extensionPaths: [join(root, "extensions/review.js")],
  });
});

test("handles unreadable prompt and asset entries without returning invalid resources", () => {
  const root = createTestDirectory();
  mkdirSync(join(root, "APPEND_SYSTEM.md"));
  writeFileSync(join(root, "skills"), "Not a directory");
  writeFileSync(join(root, "prompts"), "Not a directory");
  writeFileSync(join(root, "extensions"), "Not a directory");
  const error = spyOn(console, "error").mockImplementation(() => {});
  onTestFinished(() => error.mockRestore());
  expect(readPromptFile(root)).toBeNull();
  expect(scanDirectoryAssets(root)).toEqual({
    promptFileName: "APPEND_SYSTEM.md",
    skillNames: [],
    promptNames: [],
    extensionFileNames: [],
  });
  expect(getWorkspaceResourcePaths([root]).extensionPaths).toEqual([]);
  expect(error.mock.calls).toHaveLength(2);
});

test("rejects non-object settings and normalizes mixed setting arrays", () => {
  const root = createTestDirectory();
  writeFileSync(join(root, "settings.json"), "null");
  expect(readSettingsFile(root)).toBeNull();
  writeFileSync(
    join(root, "settings.json"),
    JSON.stringify({ defaultTools: [" read ", 1, ""], defaultModel: " balanced " }),
  );
  expect(readSettingsFile(root)).toEqual({ defaultTools: ["read"], defaultModel: "balanced" });
  expect(
    parseWorkspaceConfig({
      configs: [
        { when: "/project", load: [] },
        { when: "/project", load: "" },
      ],
    }),
  ).toBeUndefined();
  expect(parseWorkspaceConfig({ "@alexgorbatchev/pi-workspace": "invalid" })).toBeUndefined();
});

test("reads quoted comment characters and prioritizes config entries in fallback parsing", () => {
  expect(parseGitConfigLoads("[pi-workspace]\nload = /ignored\nconfig = '/path/#name;file.json' # comment\n")).toEqual([
    "/path/#name;file.json",
  ]);
});

test("handles missing config and searches past malformed Git markers within an owned repository", () => {
  const root = createTestDirectory();
  mkdirSync(join(root, ".git"));
  const child = join(root, "child");
  mkdirSync(child);
  writeFileSync(join(child, ".git"), "not a gitdir marker");
  expect(resolveGitConfigPath(root)).toBeUndefined();
  expect(resolveGitConfigPath(child)).toBeUndefined();
  writeFileSync(join(root, ".git/config"), "[core]\n\tbare = false\n");
  expect(resolveGitConfigPath(child)).toBe(join(root, ".git/config"));
});
