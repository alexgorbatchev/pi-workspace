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

    it("formats full workspace status report", () => {
      const report = formatWorkspaceReport(mockTheme, {
        workspacesRoot: "/home/.pi/agent/workspaces",
        baseDir: "/home/development",
        orgName: "example.com",
        projectName: "auth-service",
        orgPromptFile: "/home/.pi/agent/workspaces/example.com/_common/APPEND_SYSTEM.md",
        projectPromptFile: "/home/.pi/agent/workspaces/example.com/auth-service/APPEND_SYSTEM.md",
        skillCount: 2,
        promptCount: 3,
        extensionCount: 1,
      });

      expect(report).toContain("[@alexgorbatchev/pi-workspace]");
      expect(report).toContain("root: /home/.pi/agent/workspaces");
      expect(report).toContain("base: /home/development");
      expect(report).toContain("organization: example.com");
      expect(report).toContain("project: auth-service");
      expect(report).toContain("prompts: org (APPEND_SYSTEM.md), proj (APPEND_SYSTEM.md)");
      expect(report).toContain("assets: 2 skills, 3 commands, 1 extensions");
    });

    it("formats minimal report without org or prompts", () => {
      const report = formatWorkspaceReport(mockTheme, {
        workspacesRoot: "/home/.pi/agent/workspaces",
        baseDir: "/home/development",
        projectName: "solo-tool",
        skillCount: 0,
        promptCount: 0,
        extensionCount: 0,
      });

      expect(report).toContain("[@alexgorbatchev/pi-workspace]");
      expect(report).toContain("project: solo-tool");
      expect(report).not.toContain("organization:");
      expect(report).not.toContain("prompts:");
      expect(report).not.toContain("assets:");
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
    it("registers event handlers and workspace command", async () => {
      const registeredEvents: string[] = [];
      const registeredCommands: string[] = [];
      let isRendererRegistered = false;

      const mockPi = {
        registerMessageRenderer: () => {
          isRendererRegistered = true;
        },
        on: (event: string) => {
          registeredEvents.push(event);
          return () => {};
        },
        registerCommand: (name: string) => {
          registeredCommands.push(name);
        },
      };

      await workspaceExtension(mockPi as never);

      expect(isRendererRegistered).toBe(true);
      expect(registeredEvents).toContain("resources_discover");
      expect(registeredEvents).toContain("before_agent_start");
      expect(registeredEvents).toContain("session_start");
      expect(registeredCommands).toContain("workspace");
    });
  });
});
