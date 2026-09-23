import { describe, expect, it, spyOn } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyWorkspaceSettings,
  buildSystemPromptAppend,
  formatWorkspaceReport,
  loadWorkspaceExtensions,
  workspaceExtension,
} from "../workspaceExtension.js";

describe("workspaceExtension", () => {
  describe("buildSystemPromptAppend", () => {
    it("returns empty string when no prompt files exist", () => {
      const result = buildSystemPromptAppend({
        orgDirectory: "/nonexistent/org",
        projectDirectory: "/nonexistent/proj",
      });
      expect(result).toBe("");
    });

    it("layers org instructions and project instructions", () => {
      const testDir = join(tmpdir(), `pi-ws-test-${Date.now()}`);
      const orgDir = join(testDir, "org");
      const projDir = join(testDir, "proj");

      mkdirSync(orgDir, { recursive: true });
      mkdirSync(projDir, { recursive: true });

      writeFileSync(join(orgDir, "APPEND_SYSTEM.md"), "Follow company security standards.");
      writeFileSync(join(projDir, "APPEND_SYSTEM.md"), "Run npm test before committing.");

      try {
        const result = buildSystemPromptAppend({
          orgName: "example.com",
          orgDirectory: orgDir,
          projectName: "auth-service",
          projectDirectory: projDir,
        });

        expect(result).toContain("# example.com Organization Instructions");
        expect(result).toContain("Follow company security standards.");
        expect(result).toContain("# auth-service Project Instructions");
        expect(result).toContain("Run npm test before committing.");
      } finally {
        rmSync(testDir, { recursive: true, force: true });
      }
    });
  });

  describe("formatWorkspaceReport", () => {
    const mockTheme = {
      fg: (_color: string, text: string) => text,
    };

    it("formats full workspace status report with attribution by tier", () => {
      const report = formatWorkspaceReport(
        mockTheme,
        {
          workspacesRoot: "/home/.pi/agent/workspaces",
          baseDir: "/home/development",
          org: {
            name: "example.com",
            directoryPath: "/home/.pi/agent/workspaces/example.com/_common",
            promptFileName: "APPEND_SYSTEM.md",
            skillNames: ["example-auth"],
            promptNames: ["/org-audit"],
            extensionFileNames: ["telemetry.ts"],
          },
          project: {
            name: "auth-service",
            directoryPath: "/home/.pi/agent/workspaces/example.com/auth-service",
            promptFileName: "APPEND_SYSTEM.md",
            skillNames: ["auth-check"],
            promptNames: ["/proj-check"],
            extensionFileNames: [],
          },
        },
        "/home",
      );

      expect(report).toContain("[@alexgorbatchev/pi-workspace]");
      expect(report).toContain("root: ~/.pi/agent/workspaces");
      expect(report).toContain("base: ~/development");
      expect(report).toContain("organization: example.com (~/.pi/agent/workspaces/example.com/_common)");
      expect(report).toContain("prompt: APPEND_SYSTEM.md");
      expect(report).toContain("skills: 1 (example-auth)");
      expect(report).toContain("commands: 1 (/org-audit)");
      expect(report).toContain("extensions: 1 (telemetry.ts)");
      expect(report).toContain("project: auth-service (~/.pi/agent/workspaces/example.com/auth-service)");
      expect(report).toContain("skills: 1 (auth-check)");
      expect(report).toContain("commands: 1 (/proj-check)");
    });

    it("formats minimal report without org or assets", () => {
      const report = formatWorkspaceReport(
        mockTheme,
        {
          workspacesRoot: "/home/.pi/agent/workspaces",
          baseDir: "/home/development",
          project: {
            name: "solo-tool",
            directoryPath: "/home/.pi/agent/workspaces/solo-tool",
            skillNames: [],
            promptNames: [],
            extensionFileNames: [],
          },
        },
        "/home",
      );

      expect(report).toContain("[@alexgorbatchev/pi-workspace]");
      expect(report).toContain("project: solo-tool (~/.pi/agent/workspaces/solo-tool)");
      expect(report).toContain("(no assets configured)");
      expect(report).not.toContain("organization:");
    });
  });

  describe("loadWorkspaceExtensions", () => {
    it("calls module default factory with pi ExtensionAPI", async () => {
      let isFactoryCalled = false;
      let passedApi: unknown = null;

      const mockApi = { name: "mock-pi" };
      const importer = async () => ({
        default: (api: unknown) => {
          isFactoryCalled = true;
          passedApi = api;
        },
      });

      await loadWorkspaceExtensions(mockApi as never, ["/mock/ext.ts"], importer as never);

      expect(isFactoryCalled).toBe(true);
      expect(passedApi).toBe(mockApi);
    });

    it("handles extension load errors gracefully without throwing", async () => {
      const consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});
      const mockApi = { name: "mock-pi" };
      const importer = () => Promise.reject(new Error("Failed to compile extension"));

      try {
        await loadWorkspaceExtensions(mockApi as never, ["/broken/ext.ts"], importer as never);
        expect(consoleErrorSpy).toHaveBeenCalled();
      } finally {
        consoleErrorSpy.mockRestore();
      }
    });
  });

  describe("applyWorkspaceSettings", () => {
    it("applies defaultTools, defaultThinkingLevel, and defaultModel", async () => {
      let activeTools: string[] = [];
      let thinkingLevel = "";
      let selectedModel: unknown = null;

      const mockPi = {
        setActiveTools: (tools: string[]) => {
          activeTools = tools;
        },
        setThinkingLevel: (level: string) => {
          thinkingLevel = level;
        },
        setModel: async (model: unknown) => {
          selectedModel = model;
        },
      };

      const mockModels = [
        { provider: "anthropic", id: "claude-3-5-sonnet" },
        { provider: "openai", id: "gpt-4o" },
      ];

      const mockCtx = {
        modelRegistry: {
          find: (provider: string, id: string) => mockModels.find((m) => m.provider === provider && m.id === id),
          getAll: () => mockModels,
        },
      };

      const settings = [
        {
          defaultTools: ["bash", "read"],
          defaultThinkingLevel: "high",
          defaultModel: "anthropic/claude-3-5-sonnet",
        },
      ];

      await applyWorkspaceSettings(mockPi as never, mockCtx, settings);

      expect(activeTools).toEqual(["bash", "read"]);
      expect(thinkingLevel).toBe("high");
      expect(selectedModel).toEqual({ provider: "anthropic", id: "claude-3-5-sonnet" });
    });
  });

  describe("workspaceExtension registration", () => {
    it("registers event handlers and message renderer", async () => {
      const registeredEvents: string[] = [];
      let isRendererRegistered = false;

      const mockPi = {
        registerMessageRenderer: () => {
          isRendererRegistered = true;
        },
        on: (event: string) => {
          registeredEvents.push(event);
          return () => {};
        },
      };

      await workspaceExtension(mockPi as never);

      expect(isRendererRegistered).toBe(true);
      expect(registeredEvents).toContain("resources_discover");
      expect(registeredEvents).toContain("before_agent_start");
      expect(registeredEvents).toContain("session_start");
    });
  });
});
