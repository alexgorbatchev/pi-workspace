import { describe, expect, it, spyOn } from "bun:test";
import { join } from "node:path";
import {
  CONFIG_KEY,
  expandHomeDirectory,
  findPromptFile,
  getWorkspaceResourcePaths,
  parseWorkspaceConfig,
  readPromptFile,
  readSettingsFile,
  resolveBaseDir,
  resolveWorkspaceDirectories,
  resolveWorkspacesRoot,
} from "../workspaceResolver.js";

describe("workspaceResolver", () => {
  const fakeHome = "/test/home";

  describe("expandHomeDirectory", () => {
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
  });

  describe("resolveWorkspacesRoot", () => {
    it("uses default workspaces root when no config or env provided", () => {
      const resolved = resolveWorkspacesRoot({ homeDirectoryPath: fakeHome });
      expect(resolved).toBe(join(fakeHome, ".pi", "agent", "workspaces"));
    });

    it("uses config.workspacesRoot when provided", () => {
      const resolved = resolveWorkspacesRoot({
        config: { workspacesRoot: "~/my-workspaces" },
        homeDirectoryPath: fakeHome,
      });
      expect(resolved).toBe(join(fakeHome, "my-workspaces"));
    });

    it("prefers environment variable over config", () => {
      const resolved = resolveWorkspacesRoot({
        config: { workspacesRoot: "~/from-config" },
        env: { PI_WORKSPACES_ROOT: "~/from-env" },
        homeDirectoryPath: fakeHome,
      });
      expect(resolved).toBe(join(fakeHome, "from-env"));
    });
  });

  describe("resolveBaseDir", () => {
    it("uses default baseDir when no config or env provided", () => {
      const resolved = resolveBaseDir({ homeDirectoryPath: fakeHome });
      expect(resolved).toBe(join(fakeHome, "development"));
    });

    it("uses config.baseDir when provided", () => {
      const resolved = resolveBaseDir({
        config: { baseDir: "~/my-repos" },
        homeDirectoryPath: fakeHome,
      });
      expect(resolved).toBe(join(fakeHome, "my-repos"));
    });

    it("prefers environment variable over config", () => {
      const resolved = resolveBaseDir({
        config: { baseDir: "~/from-config" },
        env: { PI_WORKSPACE_BASE_DIR: "~/from-env" },
        homeDirectoryPath: fakeHome,
      });
      expect(resolved).toBe(join(fakeHome, "from-env"));
    });
  });

  describe("parseWorkspaceConfig", () => {
    it("returns undefined for null or non-object", () => {
      expect(parseWorkspaceConfig(null)).toBeUndefined();
      expect(parseWorkspaceConfig(undefined)).toBeUndefined();
      expect(parseWorkspaceConfig("invalid")).toBeUndefined();
    });

    it("returns undefined when config key is absent", () => {
      expect(parseWorkspaceConfig({ "some-other-plugin": {} })).toBeUndefined();
    });

    it("parses valid config fields", () => {
      const settings = {
        [CONFIG_KEY]: {
          workspacesRoot: "~/custom-workspaces",
          baseDir: "~/src",
          mappings: {
            "/custom/repo": "org/repo",
          },
        },
      };

      const parsed = parseWorkspaceConfig(settings);
      expect(parsed).toEqual({
        workspacesRoot: "~/custom-workspaces",
        baseDir: "~/src",
        mappings: {
          "/custom/repo": "org/repo",
        },
      });
    });

    it("filters out empty strings and invalid mappings", () => {
      const settings = {
        [CONFIG_KEY]: {
          workspacesRoot: "   ",
          baseDir: "~/valid-dir",
          mappings: {
            valid: "target",
            invalid: 123,
          },
        },
      };

      const parsed = parseWorkspaceConfig(settings);
      expect(parsed).toEqual({
        baseDir: "~/valid-dir",
        mappings: {
          valid: "target",
        },
      });
    });
  });

  describe("resolveWorkspaceDirectories", () => {
    const baseDir = join(fakeHome, "development");
    const workspacesRoot = join(fakeHome, ".pi", "agent", "workspaces");

    it("resolves org and project directories for paths inside baseDir", () => {
      const cwd = join(baseDir, "example.com", "service-a");
      const existingPaths = new Set([join(workspacesRoot, "example.com", "_common")]);

      const result = resolveWorkspaceDirectories(cwd, {
        homeDirectoryPath: fakeHome,
        fileExists: (path) => existingPaths.has(path),
      });

      expect(result.orgName).toBe("example.com");
      expect(result.projectName).toBe("service-a");
      expect(result.orgDirectory).toBe(join(workspacesRoot, "example.com", "_common"));
      expect(result.projectDirectory).toBe(join(workspacesRoot, "example.com", "service-a"));
    });

    it("prefers common directory if _common does not exist", () => {
      const cwd = join(baseDir, "acme.corp", "dashboard");
      const existingPaths = new Set([join(workspacesRoot, "acme.corp", "common")]);

      const result = resolveWorkspaceDirectories(cwd, {
        homeDirectoryPath: fakeHome,
        fileExists: (path) => existingPaths.has(path),
      });

      expect(result.orgName).toBe("acme.corp");
      expect(result.projectName).toBe("dashboard");
      expect(result.orgDirectory).toBe(join(workspacesRoot, "acme.corp", "common"));
      expect(result.projectDirectory).toBe(join(workspacesRoot, "acme.corp", "dashboard"));
    });

    it("resolves single-level project under baseDir", () => {
      const cwd = join(baseDir, "solo-project");

      const result = resolveWorkspaceDirectories(cwd, {
        homeDirectoryPath: fakeHome,
      });

      expect(result.orgName).toBeUndefined();
      expect(result.orgDirectory).toBeUndefined();
      expect(result.projectName).toBe("solo-project");
      expect(result.projectDirectory).toBe(join(workspacesRoot, "solo-project"));
    });

    it("resolves explicit mappings regardless of cwd location", () => {
      const externalCwd = "/opt/special/custom-repo";
      const config = {
        mappings: {
          "/opt/special/custom-repo": "acme/custom-repo",
        },
      };

      const result = resolveWorkspaceDirectories(externalCwd, {
        config,
        homeDirectoryPath: fakeHome,
      });

      expect(result.orgName).toBe("acme");
      expect(result.projectName).toBe("custom-repo");
      expect(result.orgDirectory).toBe(join(workspacesRoot, "acme", "_common"));
      expect(result.projectDirectory).toBe(join(workspacesRoot, "acme", "custom-repo"));
    });

    it("falls back to project name by basename for paths outside baseDir", () => {
      const externalCwd = "/tmp/untracked-checkout";

      const result = resolveWorkspaceDirectories(externalCwd, {
        homeDirectoryPath: fakeHome,
      });

      expect(result.orgName).toBeUndefined();
      expect(result.orgDirectory).toBeUndefined();
      expect(result.projectName).toBe("untracked-checkout");
      expect(result.projectDirectory).toBe(join(workspacesRoot, "untracked-checkout"));
    });
  });

  describe("findPromptFile and readPromptFile", () => {
    it("finds APPEND_SYSTEM.md first if multiple exist", () => {
      const dir = "/workspace/project";
      const existing = new Set([join(dir, "APPEND_SYSTEM.md"), join(dir, "AGENTS.md")]);

      const found = findPromptFile(dir, (p) => existing.has(p));
      expect(found).toBe(join(dir, "APPEND_SYSTEM.md"));
    });

    it("finds AGENTS.md when APPEND_SYSTEM.md and SYSTEM.md are missing", () => {
      const dir = "/workspace/project";
      const existing = new Set([join(dir, "AGENTS.md")]);

      const found = findPromptFile(dir, (p) => existing.has(p));
      expect(found).toBe(join(dir, "AGENTS.md"));
    });

    it("returns null when no prompt file exists", () => {
      const dir = "/workspace/empty";
      expect(findPromptFile(dir, () => false)).toBeNull();
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

  describe("getWorkspaceResourcePaths", () => {
    it("gathers skills, prompts, and extension files from org and project", () => {
      const orgDir = "/workspaces/example/_common";
      const projDir = "/workspaces/example/auth-service";

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
        { orgDirectory: orgDir, projectDirectory: projDir },
        (p) => existingDirs.has(p),
        (p) => dirContents.get(p) ?? [],
      );

      expect(paths.skillPaths).toEqual([join(projDir, "skills"), join(orgDir, "skills")]);
      expect(paths.promptPaths).toEqual([join(projDir, "prompts"), join(orgDir, "prompts")]);
      expect(paths.extensionPaths).toEqual([
        join(orgDir, "extensions", "telemetry.ts"),
        join(projDir, "extensions", "auth-tool.ts"),
      ]);
    });
  });
});
