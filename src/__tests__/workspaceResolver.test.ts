import { describe, expect, it, spyOn } from "bun:test";
import { join } from "node:path";
import {
  collapseHomeDirectory,
  expandHomeDirectory,
  findPromptFile,
  getWorkspaceResourcePaths,
  matchWorkspacePattern,
  parseWorkspaceConfig,
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
              glob: "/company/*",
              path: "/company/ai/commonA",
            },
            {
              glob: "/company/projB",
              path: ["/company/ai/projB", "/company/ai/projB-overrides"],
            },
          ],
        },
      };

      const parsed = parseWorkspaceConfig(settings);
      expect(parsed).toEqual({
        configs: [
          {
            glob: "/company/*",
            path: "/company/ai/commonA",
          },
          {
            glob: "/company/projB",
            path: ["/company/ai/projB", "/company/ai/projB-overrides"],
          },
        ],
      });
    });

    it("parses legacy workspaces map into configs array", () => {
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
            glob: "/company/*",
            path: "/company/ai/commonA",
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
            glob: "~/development/company/*",
            path: "~/ai/commonA",
          },
          {
            glob: "~/development/company/projB",
            path: "~/ai/projB",
          },
        ],
      };

      const matched = resolveMatchedWorkspaceConfigs(join(fakeHome, "development", "company", "projB"), {
        config,
        homeDirectoryPath: fakeHome,
        fileExists: (p) => existingPaths.has(p),
      });

      expect(matched.length).toBe(2);
      expect(matched[0]?.glob).toBe("~/development/company/*");
      expect(matched[0]?.directoryPath).toBe(orgDir);
      expect(matched[1]?.glob).toBe("~/development/company/projB");
      expect(matched[1]?.directoryPath).toBe(projDir);

      const directories = resolveWorkspaceDirectories(join(fakeHome, "development", "company", "projB"), {
        config,
        homeDirectoryPath: fakeHome,
        fileExists: (p) => existingPaths.has(p),
      });

      expect(directories).toEqual([orgDir, projDir]);
    });

    it("skips directories that do not exist on disk", () => {
      const projDir = join(fakeHome, "ai", "projB");
      const existingPaths = new Set([projDir]);

      const config = {
        configs: [
          {
            glob: "/company/*",
            path: join(fakeHome, "ai", "missing-common"),
          },
          {
            glob: "/company/projB",
            path: projDir,
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
});
