import { describe, expect, it, spyOn } from "bun:test";
import { join } from "node:path";
import {
  collapseHomeDirectory,
  expandHomeDirectory,
  findPromptFile,
  getDirectoryAssets,
  getWorkspaceResourcePaths,
  interpolateTargetTemplate,
  matchWorkspacePattern,
  parseWorkspaceConfig,
  readPromptFile,
  readSettingsFile,
  resolveWorkspaceDirectories,
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
      expect(parseWorkspaceConfig({ "@alexgorbatchev/pi-workspace": { workspaces: {} } })).toBeUndefined();
    });

    it("parses valid workspaces map with string arrays and single strings", () => {
      const settings = {
        "@alexgorbatchev/pi-workspace": {
          workspaces: {
            "~/development/company-a/*": ["~/.pi/workspaces/company-a/_common", "~/.pi/workspaces/company-a/:1"],
            "~/development/company-b/portal": "~/.pi/workspaces/company-b/portal",
          },
        },
      };

      const parsed = parseWorkspaceConfig(settings);
      expect(parsed).toEqual({
        workspaces: {
          "~/development/company-a/*": ["~/.pi/workspaces/company-a/_common", "~/.pi/workspaces/company-a/:1"],
          "~/development/company-b/portal": "~/.pi/workspaces/company-b/portal",
        },
      });
    });
  });

  describe("matchWorkspacePattern and interpolateTargetTemplate", () => {
    it("matches exact paths", () => {
      const match = matchWorkspacePattern(
        "~/development/company-b/portal",
        "/test/home/development/company-b/portal",
        fakeHome,
      );

      expect(match.isMatch).toBe(true);
      expect(match.captures).toEqual([]);
    });

    it("matches wildcard * with numeric captures", () => {
      const match = matchWorkspacePattern(
        "~/development/company-a/*",
        "/test/home/development/company-a/billing",
        fakeHome,
      );

      expect(match.isMatch).toBe(true);
      expect(match.captures).toEqual(["billing"]);
    });

    it("matches subdirectories inside matched project", () => {
      const match = matchWorkspacePattern(
        "~/development/company-a/*",
        "/test/home/development/company-a/billing/src/components",
        fakeHome,
      );

      expect(match.isMatch).toBe(true);
      expect(match.captures).toEqual(["billing"]);
    });

    it("matches named parameters", () => {
      const match = matchWorkspacePattern(
        "~/development/:org/:project",
        "/test/home/development/acme/dashboard",
        fakeHome,
      );

      expect(match.isMatch).toBe(true);
      expect(match.captures).toEqual(["acme", "dashboard"]);
      expect(match.namedCaptures).toEqual({ org: "acme", project: "dashboard" });
    });

    it("returns false when paths do not match", () => {
      const match = matchWorkspacePattern(
        "~/development/company-a/*",
        "/test/home/development/company-b/billing",
        fakeHome,
      );

      expect(match.isMatch).toBe(false);
    });

    it("interpolates numeric and named target templates", () => {
      const match = {
        isMatch: true,
        captures: ["company-a", "billing"],
        namedCaptures: { org: "company-a", project: "billing" },
      };

      expect(interpolateTargetTemplate("~/.pi/workspaces/:1/:2", match)).toBe("~/.pi/workspaces/company-a/billing");
      expect(interpolateTargetTemplate("~/.pi/workspaces/$1/$2", match)).toBe("~/.pi/workspaces/company-a/billing");
      expect(interpolateTargetTemplate("~/.pi/workspaces/:org/:project", match)).toBe(
        "~/.pi/workspaces/company-a/billing",
      );
    });
  });

  describe("resolveWorkspaceDirectories", () => {
    it("returns empty array when no config provided", () => {
      expect(resolveWorkspaceDirectories("/any/path")).toEqual([]);
    });

    it("resolves existing workspace directories in layer order", () => {
      const config = {
        workspaces: {
          "~/development/company-a/*": ["~/.pi/workspaces/company-a/_common", "~/.pi/workspaces/company-a/:1"],
        },
      };

      const orgCommon = join(fakeHome, ".pi", "workspaces", "company-a", "_common");
      const projectDir = join(fakeHome, ".pi", "workspaces", "company-a", "billing");
      const existingPaths = new Set([orgCommon, projectDir]);

      const resolved = resolveWorkspaceDirectories(join(fakeHome, "development", "company-a", "billing"), {
        config,
        homeDirectoryPath: fakeHome,
        fileExists: (p) => existingPaths.has(p),
      });

      expect(resolved).toEqual([orgCommon, projectDir]);
    });

    it("skips directories that do not exist on disk", () => {
      const config = {
        workspaces: {
          "~/development/company-a/*": ["~/.pi/workspaces/company-a/_common", "~/.pi/workspaces/company-a/:1"],
        },
      };

      const projectDir = join(fakeHome, ".pi", "workspaces", "company-a", "billing");
      const existingPaths = new Set([projectDir]);

      const resolved = resolveWorkspaceDirectories(join(fakeHome, "development", "company-a", "billing"), {
        config,
        homeDirectoryPath: fakeHome,
        fileExists: (p) => existingPaths.has(p),
      });

      expect(resolved).toEqual([projectDir]);
    });

    it("prioritizes exact pattern match over wildcard pattern match", () => {
      const config = {
        workspaces: {
          "~/development/company-a/*": ["~/.pi/workspaces/wildcard"],
          "~/development/company-a/special": ["~/.pi/workspaces/exact"],
        },
      };

      const exactDir = join(fakeHome, ".pi", "workspaces", "exact");
      const existingPaths = new Set([exactDir]);

      const resolved = resolveWorkspaceDirectories(join(fakeHome, "development", "company-a", "special"), {
        config,
        homeDirectoryPath: fakeHome,
        fileExists: (p) => existingPaths.has(p),
      });

      expect(resolved).toEqual([exactDir]);
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

  describe("getDirectoryAssets", () => {
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

      const assets = getDirectoryAssets(
        workspaceDir,
        (p) => existingPaths.has(p),
        (p) => dirContents.get(p) ?? [],
      );

      expect(assets.directoryPath).toBe(workspaceDir);
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
