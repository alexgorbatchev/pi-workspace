import { describe, expect, it, spyOn } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collapseHomeDirectory,
  expandHomeDirectory,
  findMainRepositoryRoot,
  findPromptFile,
  getWorkspaceResourcePaths,
  interpolatePathPlaceholders,
  loadGitWorkspaceConfig,
  matchWorkspacePattern,
  parseGitConfigLoads,
  parseWorkspaceConfig,
  readGitConfigLoads,
  readPromptFile,
  readSettingsFile,
  resolveMatchedWorkspaceConfigs,
  resolveWorkspaceDirectories,
  scanDirectoryAssets,
} from "../workspaceResolver.js";

describe("workspaceResolver", () => {
  const fakeHome = "/test/home";

  describe("expandHomeDirectory and collapseHomeDirectory", () => {
    it("expands single tilde to home directory", () => {
      expect(expandHomeDirectory("~", fakeHome)).toBe(fakeHome);
    });

    it("expands tilde prefix with path", () => {
      expect(expandHomeDirectory("~/projects", fakeHome)).toBe(join(fakeHome, "projects"));
    });

    it("returns unchanged path when no tilde prefix", () => {
      expect(expandHomeDirectory("/var/projects", fakeHome)).toBe("/var/projects");
      expect(expandHomeDirectory("relative/path", fakeHome)).toBe("relative/path");
    });

    it("collapses home directory to tilde", () => {
      expect(collapseHomeDirectory(fakeHome, fakeHome)).toBe("~");
      expect(collapseHomeDirectory(join(fakeHome, "development"), fakeHome)).toBe("~/development");
      expect(collapseHomeDirectory("/opt/other", fakeHome)).toBe("/opt/other");
    });
  });

  describe("parseWorkspaceConfig", () => {
    it("returns undefined for null or non-object", () => {
      expect(parseWorkspaceConfig(null)).toBeUndefined();
      expect(parseWorkspaceConfig(undefined)).toBeUndefined();
      expect(parseWorkspaceConfig("invalid")).toBeUndefined();
    });

    it("returns undefined when config key is absent or empty", () => {
      expect(parseWorkspaceConfig({ "some-other-plugin": {} })).toBeUndefined();
      expect(parseWorkspaceConfig({ "@alexgorbatchev/pi-workspace": {} })).toBeUndefined();
      expect(parseWorkspaceConfig({ "@alexgorbatchev/pi-workspace": { configs: [] } })).toBeUndefined();
    });

    it("parses valid configs array with string paths and array paths", () => {
      const settings = {
        "@alexgorbatchev/pi-workspace": {
          configs: [
            {
              when: "/company/*",
              load: "/company/ai/commonA",
            },
            {
              when: "/company/projB",
              load: ["/company/ai/projB", "/company/ai/projB-overrides"],
            },
          ],
        },
      };

      const parsed = parseWorkspaceConfig(settings);
      expect(parsed).toEqual({
        configs: [
          {
            when: "/company/*",
            load: "/company/ai/commonA",
          },
          {
            when: "/company/projB",
            load: ["/company/ai/projB", "/company/ai/projB-overrides"],
          },
        ],
      });
    });

    it("parses legacy workspaces map and glob/path keys into configs array", () => {
      const settings = {
        "@alexgorbatchev/pi-workspace": {
          workspaces: {
            "/company/*": "/company/ai/commonA",
          },
        },
      };

      const parsed = parseWorkspaceConfig(settings);
      expect(parsed).toEqual({
        configs: [
          {
            when: "/company/*",
            load: "/company/ai/commonA",
          },
        ],
      });
    });
  });

  describe("matchWorkspacePattern", () => {
    it("matches exact directory path", () => {
      expect(matchWorkspacePattern("/company/projB", "/company/projB", fakeHome)).toBe(true);
    });

    it("matches subdirectories inside matched directory", () => {
      expect(matchWorkspacePattern("/company/projB", "/company/projB/src/components", fakeHome)).toBe(true);
    });

    it("matches wildcard * with directory names", () => {
      expect(matchWorkspacePattern("/company/*", "/company/projB", fakeHome)).toBe(true);
      expect(matchWorkspacePattern("/company/*", "/company/projB/src/index.ts", fakeHome)).toBe(true);
    });

    it("returns false when path does not match", () => {
      expect(matchWorkspacePattern("/company/*", "/other/projB", fakeHome)).toBe(false);
      expect(matchWorkspacePattern("/company/projB", "/company/projC", fakeHome)).toBe(false);
      expect(matchWorkspacePattern("/company/projB", "/company", fakeHome)).toBe(false);
    });

    it("expands tildes when matching", () => {
      expect(
        matchWorkspacePattern("~/development/company/*", "/test/home/development/company/auth-service", fakeHome),
      ).toBe(true);
    });
  });

  describe("interpolatePathPlaceholders", () => {
    it("interpolates [project], :project, and [name] placeholders", () => {
      expect(interpolatePathPlaceholders("/ai/[project]", "garaje")).toBe("/ai/garaje");
      expect(interpolatePathPlaceholders("/ai/:project", "garaje")).toBe("/ai/garaje");
      expect(interpolatePathPlaceholders("/ai/[name]", "garaje")).toBe("/ai/garaje");
    });

    it("interpolates numeric captures :1 and $1", () => {
      expect(interpolatePathPlaceholders("/ai/:1/layer", "proj", ["captured"])).toBe("/ai/captured/layer");
      expect(interpolatePathPlaceholders("/ai/$1/layer", "proj", ["captured"])).toBe("/ai/captured/layer");
    });

    it("leaves strings without placeholders unchanged", () => {
      expect(interpolatePathPlaceholders("/ai/envoy", "garaje")).toBe("/ai/envoy");
    });
  });

  describe("resolveMatchedWorkspaceConfigs and resolveWorkspaceDirectories", () => {
    it("returns empty array when no config provided", () => {
      expect(resolveMatchedWorkspaceConfigs("/any/path")).toEqual([]);
      expect(resolveWorkspaceDirectories("/any/path")).toEqual([]);
    });

    it("matches multiple cascading rules (broad org rule AND exact project rule)", () => {
      const orgDir = join(fakeHome, "ai", "commonA");
      const projDir = join(fakeHome, "ai", "projB");
      const existingPaths = new Set([orgDir, projDir]);

      const config = {
        configs: [
          {
            when: "~/development/company/*",
            load: "~/ai/commonA",
          },
          {
            when: "~/development/company/projB",
            load: "~/ai/projB",
          },
        ],
      };

      const matched = resolveMatchedWorkspaceConfigs(join(fakeHome, "development", "company", "projB"), {
        config,
        homeDirectoryPath: fakeHome,
        fileExists: (p) => existingPaths.has(p),
      });

      expect(matched.length).toBe(2);
      expect(matched[0]?.when).toBe("~/development/company/*");
      expect(matched[0]?.load).toBe(orgDir);
      expect(matched[1]?.when).toBe("~/development/company/projB");
      expect(matched[1]?.load).toBe(projDir);

      const directories = resolveWorkspaceDirectories(join(fakeHome, "development", "company", "projB"), {
        config,
        homeDirectoryPath: fakeHome,
        fileExists: (p) => existingPaths.has(p),
      });

      expect(directories).toEqual([orgDir, projDir]);
    });

    it("interpolates [project] in load paths from wildcard capture", () => {
      const commonDir = join(fakeHome, "ai", "envoy");
      const projectDir = join(fakeHome, "ai", "garaje");
      const existingPaths = new Set([commonDir, projectDir]);

      const config = {
        configs: [
          {
            when: "~/development/envoy.com/*",
            load: ["~/ai/envoy", "~/ai/[project]"],
          },
        ],
      };

      const matched = resolveMatchedWorkspaceConfigs(join(fakeHome, "development", "envoy.com", "garaje"), {
        config,
        homeDirectoryPath: fakeHome,
        fileExists: (p) => existingPaths.has(p),
      });

      expect(matched).toHaveLength(2);
      expect(matched[0]?.load).toBe(commonDir);
      expect(matched[1]?.load).toBe(projectDir);
    });

    it("skips directories that do not exist on disk", () => {
      const projDir = join(fakeHome, "ai", "projB");
      const existingPaths = new Set([projDir]);

      const config = {
        configs: [
          {
            when: "/company/*",
            load: join(fakeHome, "ai", "missing-common"),
          },
          {
            when: "/company/projB",
            load: projDir,
          },
        ],
      };

      const directories = resolveWorkspaceDirectories("/company/projB", {
        config,
        fileExists: (p) => existingPaths.has(p),
      });

      expect(directories).toEqual([projDir]);
    });
  });

  describe("findMainRepositoryRoot and worktree support", () => {
    it("returns undefined when no .git is found", () => {
      expect(findMainRepositoryRoot("/test/home/nonexistent")).toBeUndefined();
    });

    it("resolves main repository root for a worktree", () => {
      const testBase = join(tmpdir(), `pi-wt-unit-${Date.now()}`);
      const mainRepo = join(testBase, "repo");
      const worktreeDir = join(mainRepo, ".worktrees", "task-1");

      mkdirSync(mainRepo, { recursive: true });
      mkdirSync(worktreeDir, { recursive: true });

      const gitDir = join(mainRepo, ".git", "worktrees", "task-1");
      mkdirSync(gitDir, { recursive: true });

      writeFileSync(join(worktreeDir, ".git"), `gitdir: ${gitDir}\n`);
      writeFileSync(join(gitDir, "commondir"), "../..\n");
      mkdirSync(join(mainRepo, ".git"), { recursive: true });

      try {
        const detected = findMainRepositoryRoot(worktreeDir);
        expect(detected).toBe(mainRepo);

        const subfolder = join(worktreeDir, "src", "nested");
        mkdirSync(subfolder, { recursive: true });
        expect(findMainRepositoryRoot(subfolder)).toBe(mainRepo);
      } finally {
        rmSync(testBase, { recursive: true, force: true });
      }
    });

    it("matches workspace rules when cwd is inside a git worktree", () => {
      const testBase = join(tmpdir(), `pi-wt-match-${Date.now()}`);
      const mainRepo = join(testBase, "company", "projB");
      const worktreeDir = join(mainRepo, ".worktrees", "task-1");
      const assetDir = join(testBase, "ai", "projB");

      mkdirSync(mainRepo, { recursive: true });
      mkdirSync(worktreeDir, { recursive: true });
      mkdirSync(assetDir, { recursive: true });

      const gitDir = join(mainRepo, ".git", "worktrees", "task-1");
      mkdirSync(gitDir, { recursive: true });
      writeFileSync(join(worktreeDir, ".git"), `gitdir: ${gitDir}\n`);
      writeFileSync(join(gitDir, "commondir"), "../..\n");

      const config = {
        configs: [
          {
            when: join(testBase, "company", "projB"),
            load: assetDir,
          },
        ],
      };

      try {
        const matched = resolveMatchedWorkspaceConfigs(worktreeDir, { config });
        expect(matched.length).toBe(1);
        expect(matched[0]?.load).toBe(assetDir);
      } finally {
        rmSync(testBase, { recursive: true, force: true });
      }
    });
  });

  describe("findPromptFile and readPromptFile", () => {
    it("finds APPEND_SYSTEM.md first if multiple exist", () => {
      const dir = "/workspace/project";
      const existing = new Set([join(dir, "APPEND_SYSTEM.md"), join(dir, "AGENTS.md")]);

      const found = findPromptFile(dir, (p) => existing.has(p));
      expect(found).toBe(join(dir, "APPEND_SYSTEM.md"));
    });

    it("reads and trims prompt file content", () => {
      const dir = "/workspace/project";
      const promptPath = join(dir, "APPEND_SYSTEM.md");
      const existing = new Set([promptPath]);
      const fileContents = new Map([[promptPath, "   \n# Guidelines\nDo TDD.\n\n  "]]);

      const content = readPromptFile(
        dir,
        (p) => existing.has(p),
        (p) => fileContents.get(p) ?? "",
      );

      expect(content).toBe("# Guidelines\nDo TDD.");
    });
  });

  describe("readSettingsFile", () => {
    it("returns null when settings.json does not exist", () => {
      expect(readSettingsFile("/no-settings", () => false)).toBeNull();
    });

    it("parses valid settings fields", () => {
      const dir = "/workspace/proj";
      const settingsPath = join(dir, "settings.json");
      const content = JSON.stringify({
        defaultTools: ["bash", "read"],
        defaultThinkingLevel: "high",
        defaultModel: "anthropic/claude-3-5-sonnet",
      });

      const parsed = readSettingsFile(
        dir,
        (p) => p === settingsPath,
        () => content,
      );

      expect(parsed).toEqual({
        defaultTools: ["bash", "read"],
        defaultThinkingLevel: "high",
        defaultModel: "anthropic/claude-3-5-sonnet",
      });
    });

    it("returns null for malformed JSON or empty settings", () => {
      const consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});
      const dir = "/workspace/proj";
      const settingsPath = join(dir, "settings.json");

      try {
        expect(
          readSettingsFile(
            dir,
            (p) => p === settingsPath,
            () => "{ invalid json",
          ),
        ).toBeNull();

        expect(
          readSettingsFile(
            dir,
            (p) => p === settingsPath,
            () => "{}",
          ),
        ).toBeNull();
      } finally {
        consoleErrorSpy.mockRestore();
      }
    });
  });

  describe("scanDirectoryAssets", () => {
    it("extracts prompt file name, skill names, prompt command names, and extension file names", () => {
      const workspaceDir = "/workspaces/company/_common";
      const existingPaths = new Set([
        join(workspaceDir, "APPEND_SYSTEM.md"),
        join(workspaceDir, "skills"),
        join(workspaceDir, "skills", "deploy-check", "SKILL.md"),
        join(workspaceDir, "prompts"),
        join(workspaceDir, "extensions"),
      ]);

      const dirContents = new Map([
        [join(workspaceDir, "skills"), ["security-audit.md", "deploy-check"]],
        [join(workspaceDir, "prompts"), ["review.md", "compliance.md"]],
        [join(workspaceDir, "extensions"), ["auth.ts", "auth.test.ts", "types.d.ts"]],
      ]);

      const assets = scanDirectoryAssets(
        workspaceDir,
        (p) => existingPaths.has(p),
        (p) => dirContents.get(p) ?? [],
      );

      expect(assets.promptFileName).toBe("APPEND_SYSTEM.md");
      expect(assets.skillNames).toEqual(["security-audit", "deploy-check"]);
      expect(assets.promptNames).toEqual(["review", "compliance"]);
      expect(assets.extensionFileNames).toEqual(["auth.ts"]);
    });
  });

  describe("getWorkspaceResourcePaths", () => {
    it("gathers skills, prompts, and extension files from layer directories", () => {
      const orgDir = "/workspaces/company/_common";
      const projDir = "/workspaces/company/auth-service";

      const existingDirs = new Set([
        join(projDir, "skills"),
        join(orgDir, "skills"),
        join(projDir, "prompts"),
        join(orgDir, "prompts"),
        join(orgDir, "extensions"),
        join(projDir, "extensions"),
      ]);

      const dirContents = new Map([
        [join(orgDir, "extensions"), ["telemetry.ts", "readme.md", "types.d.ts"]],
        [join(projDir, "extensions"), ["auth-tool.ts", "auth-tool.test.ts"]],
      ]);

      const paths = getWorkspaceResourcePaths(
        [orgDir, projDir],
        (p) => existingDirs.has(p),
        (p) => dirContents.get(p) ?? [],
      );

      expect(paths.skillPaths).toEqual([join(orgDir, "skills"), join(projDir, "skills")]);
      expect(paths.promptPaths).toEqual([join(orgDir, "prompts"), join(projDir, "prompts")]);
      expect(paths.extensionPaths).toEqual([
        join(orgDir, "extensions", "telemetry.ts"),
        join(projDir, "extensions", "auth-tool.ts"),
      ]);
    });
  });

  describe("parseGitConfigLoads", () => {
    it("returns empty array for empty or unrelated git config", () => {
      const content = [
        "[core]",
        "\trepositoryformatversion = 0",
        "\tbare = false",
        '[remote "origin"]',
        "\turl = git@github.com:foo/bar.git",
      ].join("\n");
      expect(parseGitConfigLoads(content)).toEqual([]);
    });

    it("parses single load key in [pi-workspace]", () => {
      const content = ["[pi-workspace]", "\tload = ~/.pi/workspaces/company/auth-service"].join("\n");
      expect(parseGitConfigLoads(content)).toEqual(["~/.pi/workspaces/company/auth-service"]);
    });

    it("parses multiple load lines in [pi-workspace]", () => {
      const content = [
        "[pi-workspace]",
        "\tload = ~/.pi/workspaces/company/_common",
        "\tload = ~/.pi/workspaces/company/auth-service",
      ].join("\n");
      expect(parseGitConfigLoads(content)).toEqual([
        "~/.pi/workspaces/company/_common",
        "~/.pi/workspaces/company/auth-service",
      ]);
    });

    it("parses comma-separated values in load key", () => {
      const content = [
        "[pi-workspace]",
        "\tload = ~/.pi/workspaces/company/_common, ~/.pi/workspaces/company/auth-service",
      ].join("\n");
      expect(parseGitConfigLoads(content)).toEqual([
        "~/.pi/workspaces/company/_common",
        "~/.pi/workspaces/company/auth-service",
      ]);
    });

    it("strips comments, trims whitespace, and unquotes values", () => {
      const content = [
        "# global comment",
        "[pi-workspace] # inline comment",
        "\t# line comment",
        "\t; semicolon comment",
        '\tload = "  ~/.pi/workspaces/with spaces/proj  "',
      ].join("\n");
      expect(parseGitConfigLoads(content)).toEqual(["~/.pi/workspaces/with spaces/proj"]);
    });

    it("falls back to path key if load key is absent", () => {
      const content = ["[pi-workspace]", "\tpath = ~/.pi/workspaces/legacy/proj"].join("\n");
      expect(parseGitConfigLoads(content)).toEqual(["~/.pi/workspaces/legacy/proj"]);
    });
  });

  describe("readGitConfigLoads", () => {
    it("uses custom gitConfigReader when provided in options", () => {
      const customLoads = ["/custom/workspace/a", "/custom/workspace/b"];
      const loads = readGitConfigLoads("/any/repo", {
        gitConfigReader: () => customLoads,
      });
      expect(loads).toEqual(customLoads);
    });

    it("reads loads directly from file using custom fileReader", () => {
      const configContent = ["[pi-workspace]", "\tload = /mock/dir/one"].join("\n");
      const loads = readGitConfigLoads("/mock/repo", {
        fileExists: (p) => p.endsWith(".git/config"),
        fileReader: () => configContent,
      });
      expect(loads).toEqual(["/mock/dir/one"]);
    });
  });

  describe("loadGitWorkspaceConfig", () => {
    it("returns undefined when directory is not inside a git repository", () => {
      const nonGitDir = join(tmpdir(), `non-git-${Date.now()}`);
      mkdirSync(nonGitDir, { recursive: true });
      try {
        expect(loadGitWorkspaceConfig(nonGitDir)).toBeUndefined();
      } finally {
        rmSync(nonGitDir, { recursive: true, force: true });
      }
    });

    it("returns undefined when git repo has no pi-workspace.load configured", () => {
      const testDir = join(tmpdir(), `git-empty-config-${Date.now()}`);
      const gitDir = join(testDir, ".git");
      mkdirSync(gitDir, { recursive: true });
      writeFileSync(join(gitDir, "config"), "[core]\n\tbare = false\n");

      try {
        expect(loadGitWorkspaceConfig(testDir)).toBeUndefined();
      } finally {
        rmSync(testDir, { recursive: true, force: true });
      }
    });

    it("loads workspace config from git config and resolves relative paths to repo root", () => {
      const testDir = join(tmpdir(), `git-configured-repo-${Date.now()}`);
      const gitDir = join(testDir, ".git");
      mkdirSync(gitDir, { recursive: true });

      writeFileSync(
        join(gitDir, "config"),
        `[core]\n\tbare = false\n[pi-workspace]\n\tload = ./workspaces/common, ./workspaces/project\n`,
      );

      try {
        const config = loadGitWorkspaceConfig(testDir);
        expect(config).toBeDefined();
        expect(config?.configs).toHaveLength(1);
        expect(config?.configs?.[0]?.when).toBe(collapseHomeDirectory(testDir));
        expect(config?.configs?.[0]?.load).toEqual([
          join(testDir, "workspaces", "common"),
          join(testDir, "workspaces", "project"),
        ]);
      } finally {
        rmSync(testDir, { recursive: true, force: true });
      }
    });

    it("resolves config when cwd is a subdirectory of the git repository", () => {
      const testDir = join(tmpdir(), `git-sub-repo-${Date.now()}`);
      const gitDir = join(testDir, ".git");
      const subDir = join(testDir, "src", "nested");
      mkdirSync(gitDir, { recursive: true });
      mkdirSync(subDir, { recursive: true });

      writeFileSync(
        join(gitDir, "config"),
        `[core]\n\tbare = false\n[pi-workspace]\n\tload = ~/.pi/workspaces/company/auth-service\n`,
      );

      try {
        const config = loadGitWorkspaceConfig(subDir, { homeDirectoryPath: fakeHome });
        expect(config).toBeDefined();
        expect(config?.configs).toHaveLength(1);
        expect(config?.configs?.[0]?.when).toBe(collapseHomeDirectory(testDir, fakeHome));
        expect(config?.configs?.[0]?.load).toBe(join(fakeHome, ".pi", "workspaces", "company", "auth-service"));
      } finally {
        rmSync(testDir, { recursive: true, force: true });
      }
    });

    it("resolves config when cwd is a git worktree inheriting main repo config", () => {
      const testDir = join(tmpdir(), `git-wt-test-${Date.now()}`);
      const mainRepo = join(testDir, "main-repo");
      const mainGitDir = join(mainRepo, ".git");
      const worktreeDir = join(testDir, "worktree-1");
      const wtGitDir = join(mainGitDir, "worktrees", "worktree-1");

      mkdirSync(mainGitDir, { recursive: true });
      mkdirSync(wtGitDir, { recursive: true });
      mkdirSync(worktreeDir, { recursive: true });

      writeFileSync(
        join(mainGitDir, "config"),
        `[core]\n\tbare = false\n[pi-workspace]\n\tload = ./fixtures/workspace\n`,
      );
      writeFileSync(join(wtGitDir, "commondir"), "../..\n");
      writeFileSync(join(worktreeDir, ".git"), `gitdir: ${wtGitDir}\n`);

      try {
        const config = loadGitWorkspaceConfig(worktreeDir);
        expect(config).toBeDefined();
        expect(config?.configs).toHaveLength(1);
        expect(config?.configs?.[0]?.when).toBe(collapseHomeDirectory(mainRepo));
        expect(config?.configs?.[0]?.load).toBe(join(mainRepo, "fixtures", "workspace"));
      } finally {
        rmSync(testDir, { recursive: true, force: true });
      }
    });
  });
});
