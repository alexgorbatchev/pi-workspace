import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import type {
  ExtensionImporterFn,
  IModelRegistryLookup,
  ISettingsContext,
  IWorkspaceConfig,
  IWorkspaceDirectories,
  IWorkspaceSettings,
} from "./types.js";
import {
  findPromptFile,
  getWorkspaceResourcePaths,
  parseWorkspaceConfig,
  readPromptFile,
  readSettingsFile,
  resolveBaseDir,
  resolveWorkspaceDirectories,
  resolveWorkspacesRoot,
} from "./workspaceResolver.js";

const VALID_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
type ThinkingLevel = (typeof VALID_THINKING_LEVELS)[number];

function isValidThinkingLevel(level: string): level is ThinkingLevel {
  return VALID_THINKING_LEVELS.includes(level as ThinkingLevel);
}

export function loadEffectiveConfig(cwd: string): IWorkspaceConfig | undefined {
  try {
    const settingsManager = SettingsManager.create(cwd);
    const globalConfig = parseWorkspaceConfig(settingsManager.getGlobalSettings());
    const projectConfig = parseWorkspaceConfig(settingsManager.getProjectSettings());

    if (!globalConfig && !projectConfig) {
      return undefined;
    }

    return {
      ...(globalConfig?.workspacesRoot ? { workspacesRoot: globalConfig.workspacesRoot } : {}),
      ...(projectConfig?.workspacesRoot ? { workspacesRoot: projectConfig.workspacesRoot } : {}),
      ...(globalConfig?.baseDir ? { baseDir: globalConfig.baseDir } : {}),
      ...(projectConfig?.baseDir ? { baseDir: projectConfig.baseDir } : {}),
      mappings: {
        ...globalConfig?.mappings,
        ...projectConfig?.mappings,
      },
    };
  } catch (error) {
    console.error("[pi-workspace] Failed to load workspace configuration:", error);
    return undefined;
  }
}

export async function loadWorkspaceExtensions(
  pi: ExtensionAPI,
  extensionPaths: readonly string[],
  importer: ExtensionImporterFn = (extensionPath) => import(extensionPath),
): Promise<void> {
  for (const extensionPath of extensionPaths) {
    try {
      const extensionModule = await importer(extensionPath);
      const extensionFactory = extensionModule.default;
      if (typeof extensionFactory === "function") {
        await extensionFactory(pi);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[pi-workspace] Error loading workspace extension ${extensionPath}: ${message}`);
    }
  }
}

function findModelByName(modelRegistry: IModelRegistryLookup, modelName: string): unknown {
  const trimmed = modelName.trim();
  if (trimmed.includes("/")) {
    const slashIndex = trimmed.indexOf("/");
    const provider = trimmed.slice(0, slashIndex);
    const id = trimmed.slice(slashIndex + 1);
    const exactMatch = modelRegistry.find(provider, id);
    if (exactMatch) {
      return exactMatch;
    }
  }

  const allModels = modelRegistry.getAll();
  return (
    allModels.find((m) => m.id === trimmed || `${m.provider}/${m.id}` === trimmed) ??
    allModels.find((m) => m.id.toLowerCase() === trimmed.toLowerCase())
  );
}

export async function applyWorkspaceSettings(
  pi: ExtensionAPI,
  ctx: ISettingsContext,
  settingsList: readonly IWorkspaceSettings[],
): Promise<void> {
  for (const settings of settingsList) {
    if (settings.defaultTools) {
      pi.setActiveTools(settings.defaultTools);
    }
    if (settings.defaultThinkingLevel && isValidThinkingLevel(settings.defaultThinkingLevel)) {
      pi.setThinkingLevel(settings.defaultThinkingLevel);
    }
    if (settings.defaultModel) {
      const matchedModel = findModelByName(ctx.modelRegistry, settings.defaultModel);
      if (matchedModel) {
        await pi.setModel(matchedModel as never);
      }
    }
  }
}

export function buildSystemPromptAppend(directories: IWorkspaceDirectories): string {
  const promptSections: string[] = [];

  if (directories.orgDirectory) {
    const orgPromptContent = readPromptFile(directories.orgDirectory);
    if (orgPromptContent) {
      const title = directories.orgName
        ? `${directories.orgName} Organization Instructions`
        : "Organization Instructions";
      promptSections.push(`\n\n# ${title}\n\n${orgPromptContent}`);
    }
  }

  if (directories.projectDirectory) {
    const projectPromptContent = readPromptFile(directories.projectDirectory);
    if (projectPromptContent) {
      const title = directories.projectName
        ? `${directories.projectName} Project Instructions`
        : "Project Instructions";
      promptSections.push(`\n\n# ${title}\n\n${projectPromptContent}`);
    }
  }

  return promptSections.join("\n");
}

export async function workspaceExtension(pi: ExtensionAPI): Promise<void> {
  const initialCurrentDirectory = process.cwd();
  const initialConfig = loadEffectiveConfig(initialCurrentDirectory);
  const initialDirectories = resolveWorkspaceDirectories(initialCurrentDirectory, { config: initialConfig });
  const initialResourcePaths = getWorkspaceResourcePaths(initialDirectories);

  // 1. Dynamic extension loading during startup
  await loadWorkspaceExtensions(pi, initialResourcePaths.extensionPaths);

  // 2. Discover skills and prompt templates (commands)
  pi.on("resources_discover", async (event) => {
    const effectiveConfig = loadEffectiveConfig(event.cwd);
    const currentDirectories = resolveWorkspaceDirectories(event.cwd, { config: effectiveConfig });
    const resourcePaths = getWorkspaceResourcePaths(currentDirectories);

    return {
      skillPaths: resourcePaths.skillPaths,
      promptPaths: resourcePaths.promptPaths,
    };
  });

  // 3. Inject system prompt instructions
  pi.on("before_agent_start", async (event, ctx) => {
    const effectiveConfig = loadEffectiveConfig(ctx.cwd);
    const currentDirectories = resolveWorkspaceDirectories(ctx.cwd, { config: effectiveConfig });
    const addition = buildSystemPromptAppend(currentDirectories);

    if (addition.length > 0) {
      return {
        systemPrompt: `${event.systemPrompt}${addition}`,
      };
    }
  });

  // 4. Apply workspace settings (model, thinking, tools)
  pi.on("session_start", async (_event, ctx) => {
    const effectiveConfig = loadEffectiveConfig(ctx.cwd);
    const currentDirectories = resolveWorkspaceDirectories(ctx.cwd, { config: effectiveConfig });

    const settingsToApply: IWorkspaceSettings[] = [];
    if (currentDirectories.orgDirectory) {
      const orgSettings = readSettingsFile(currentDirectories.orgDirectory);
      if (orgSettings) {
        settingsToApply.push(orgSettings);
      }
    }
    if (
      currentDirectories.projectDirectory &&
      currentDirectories.projectDirectory !== currentDirectories.orgDirectory
    ) {
      const projectSettings = readSettingsFile(currentDirectories.projectDirectory);
      if (projectSettings) {
        settingsToApply.push(projectSettings);
      }
    }

    await applyWorkspaceSettings(pi, ctx, settingsToApply);
  });

  // 5. Register /workspace command for inspectability
  pi.registerCommand("workspace", {
    description: "Inspect active workspace resolution, directories, and discovered assets",
    handler: async (_args: string, ctx: ExtensionCommandContext): Promise<void> => {
      const effectiveConfig = loadEffectiveConfig(ctx.cwd);
      const workspacesRoot = resolveWorkspacesRoot({ config: effectiveConfig });
      const baseDir = resolveBaseDir({ config: effectiveConfig });
      const currentDirectories = resolveWorkspaceDirectories(ctx.cwd, { config: effectiveConfig });
      const resourcePaths = getWorkspaceResourcePaths(currentDirectories);

      const lines: string[] = [
        "Workspace Information:",
        `  Workspaces Root: ${workspacesRoot}`,
        `  Base Directory:   ${baseDir}`,
        `  Current CWD:      ${ctx.cwd}`,
        "",
        `  Organization:     ${currentDirectories.orgName ?? "(none)"}`,
        `  Org Directory:    ${currentDirectories.orgDirectory ?? "(none)"}`,
        `  Org Prompt:       ${currentDirectories.orgDirectory ? (findPromptFile(currentDirectories.orgDirectory) ?? "(none)") : "(none)"}`,
        "",
        `  Project:          ${currentDirectories.projectName ?? "(none)"}`,
        `  Project Directory:${currentDirectories.projectDirectory ?? "(none)"}`,
        `  Project Prompt:   ${currentDirectories.projectDirectory ? (findPromptFile(currentDirectories.projectDirectory) ?? "(none)") : "(none)"}`,
        "",
        `  Discovered Skills:     ${resourcePaths.skillPaths.length}`,
        ...resourcePaths.skillPaths.map((p) => `    - ${p}`),
        `  Discovered Prompts:    ${resourcePaths.promptPaths.length}`,
        ...resourcePaths.promptPaths.map((p) => `    - ${p}`),
        `  Loaded Extensions:     ${resourcePaths.extensionPaths.length}`,
        ...resourcePaths.extensionPaths.map((p) => `    - ${p}`),
      ];

      ctx.ui.notify(lines.join("\n"), "info");
    },
  });
}
