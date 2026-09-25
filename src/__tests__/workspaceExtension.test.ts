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
      const result = buildSystemPromptAppend(["/nonexistent/org", "/nonexistent/proj"]);
      expect(result).toBe("");
    });

    it("appends prompt files verbatim in layer order without synthetic headers", () => {
      const testDir = join(tmpdir(), `pi-ws-test-${Date.now()}`);
      const orgDir = join(testDir, "org");
      const projDir = join(testDir, "proj");

      mkdirSync(orgDir, { recursive: true });
      mkdirSync(projDir, { recursive: true });

      writeFileSync(join(orgDir, "APPEND_SYSTEM.md"), "# Company Standards\nFollow security rules.");
      writeFileSync(join(projDir, "APPEND_SYSTEM.md"), "# Project Standards\nRun tests before commit.");

      try {
        const result = buildSystemPromptAppend([orgDir, projDir]);

        expect(result).toBe(
          "\n\n# Company Standards\nFollow security rules.\n\n# Project Standards\nRun tests before commit.",
        );
        expect(result).not.toContain("Organization Instructions");
        expect(result).not.toContain("Project Instructions");
      } finally {
        rmSync(testDir, { recursive: true, force: true });
      }
    });
  });

  describe("formatWorkspaceReport", () => {
    const mockTheme = {
      fg: (_color: string, text: string) => text,
    };

    it("formats full workspace status report with cwd and config blocks", () => {
      const report = formatWorkspaceReport(
        mockTheme,
        {
          cwd: "/home/development/company-a/auth-service",
          configs: [
            {
              when: "~/development/company-a/*",
              load: "/home/.pi/workspaces/company-a/_common",
              promptFileName: "APPEND_SYSTEM.md",
              skillNames: ["company-auth"],
              promptNames: ["jira-check", "org-audit"],
              extensionFileNames: ["telemetry.ts"],
            },
            {
              when: "~/development/company-a/auth-service",
              load: "/home/.pi/workspaces/company-a/auth-service",
              promptFileName: "APPEND_SYSTEM.md",
              skillNames: ["alpha-skill", "beta-skill"],
              promptNames: ["proj-check"],
              extensionFileNames: [],
            },
          ],
        },
        "/home",
      );

      expect(report).toContain("[@alexgorbatchev/pi-workspace]");
      expect(report).toContain("cwd: ~/development/company-a/auth-service");
      expect(report).toContain("config:");
      expect(report).toContain("when: ~/development/company-a/*");
      expect(report).toContain("load: ~/.pi/workspaces/company-a/_common");
      expect(report).toContain("prompt: APPEND_SYSTEM.md");
      expect(report).toContain("    skills:\n      - company-auth");
      expect(report).toContain("    commands:\n      - jira-check\n      - org-audit");
      expect(report).toContain("    extensions:\n      - telemetry.ts");
      expect(report).toContain("when: ~/development/company-a/auth-service");
      expect(report).toContain("load: ~/.pi/workspaces/company-a/auth-service");
      expect(report).toContain("    skills:\n      - alpha-skill\n      - beta-skill");
      expect(report).toContain("    commands:\n      - proj-check");
    });

    it("formats minimal report without assets", () => {
      const report = formatWorkspaceReport(
        mockTheme,
        {
          cwd: "/home/development/company-b/portal",
          configs: [
            {
              when: "/company-b/portal",
              load: "/home/.pi/workspaces/company-b/portal",
              skillNames: [],
              promptNames: [],
              extensionFileNames: [],
            },
          ],
        },
        "/home",
      );

      expect(report).toContain("[@alexgorbatchev/pi-workspace]");
      expect(report).toContain("cwd: ~/development/company-b/portal");
      expect(report).toContain("config:");
      expect(report).toContain("when: /company-b/portal");
      expect(report).toContain("load: ~/.pi/workspaces/company-b/portal");
      expect(report).toContain("(no assets configured)");
    });

    it("formats empty report when no workspaces matched", () => {
      const report = formatWorkspaceReport(mockTheme, { cwd: "/home/development/unmatched", configs: [] }, "/home");
      expect(report).toContain("(no matching workspace config)");
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
