import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type {
  ExtensionImporterFn,
  IModelRegistryLookup,
  ISettingsContext,
  IThemeFormatter,
  IWorkspaceConfig,
  IWorkspaceMatchedConfig,
  IWorkspaceReportDetails,
  IWorkspaceSettings,
} from "./types.js";
import {
  collapseHomeDirectory,
  CONFIG_KEY,
  findMainRepositoryRoot,
  getWorkspaceResourcePaths,
  parseWorkspaceConfig,
  readPromptFile,
  readSettingsFile,
  resolveMatchedWorkspaceConfigs,
  resolveWorkspaceDirectories,
} from "./workspaceResolver.js";

const VALID_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
type ThinkingLevel = (typeof VALID_THINKING_LEVELS)[number];

interface ITextContentPart {
  readonly type: "text";
  readonly text: string;
}

function isTextContentPart(part: unknown): part is ITextContentPart {
  return (
    typeof part === "object" &&
    part !== null &&
    "type" in part &&
    part.type === "text" &&
    "text" in part &&
    typeof part.text === "string"
  );
}

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

    const mergedConfigs = [...(globalConfig?.configs ?? []), ...(projectConfig?.configs ?? [])];

    return {
      configs: mergedConfigs,
    };
  } catch (error) {
    console.error("[pi-workspace] Failed to load workspace configuration:", error);
    return undefined;
  }
}

function formatAssetList(theme: IThemeFormatter, label: string, items: readonly string[]): string {
  if (items.length === 0) {
    return "";
  }
  const cleanItems = items.map((item) => (label === "commands" && item.startsWith("/") ? item.slice(1) : item));
  const sortedItems = [...cleanItems].sort((firstItem, secondItem) => firstItem.localeCompare(secondItem));
  let result = theme.fg("accent", `    ${label}:`) + "\n";
  for (const item of sortedItems) {
    result += theme.fg("dim", `      - ${item}`) + "\n";
  }
  return result;
}

function formatConfigBlock(theme: IThemeFormatter, item: IWorkspaceMatchedConfig, homeDirectoryPath?: string): string {
  const displayGlob = collapseHomeDirectory(item.glob, homeDirectoryPath);
  const displayPath = collapseHomeDirectory(item.directoryPath, homeDirectoryPath);

  let sectionText = theme.fg("accent", "  config:") + "\n";
  sectionText += theme.fg("accent", "    glob: ") + theme.fg("dim", displayGlob) + "\n";
  if (displayPath !== displayGlob) {
    sectionText += theme.fg("accent", "    path: ") + theme.fg("dim", displayPath) + "\n";
  }

  let hasContributions = false;
  if (item.promptFileName) {
    sectionText += theme.fg("accent", "    prompt: ") + theme.fg("dim", item.promptFileName) + "\n";
    hasContributions = true;
  }
  if (item.skillNames.length > 0) {
    sectionText += formatAssetList(theme, "skills", item.skillNames);
    hasContributions = true;
  }
  if (item.promptNames.length > 0) {
    sectionText += formatAssetList(theme, "commands", item.promptNames);
    hasContributions = true;
  }
  if (item.extensionFileNames.length > 0) {
    sectionText += formatAssetList(theme, "extensions", item.extensionFileNames);
    hasContributions = true;
  }

  if (!hasContributions) {
    sectionText += theme.fg("dim", "    (no assets configured)") + "\n";
  }

  return sectionText;
}

export function formatWorkspaceReport(
  theme: IThemeFormatter,
  details: IWorkspaceReportDetails,
  homeDirectoryPath?: string,
): string {
  let reportText = theme.fg("mdHeading", `[${CONFIG_KEY}]`) + "\n";
  reportText +=
    theme.fg("accent", "  cwd: ") + theme.fg("dim", collapseHomeDirectory(details.cwd, homeDirectoryPath)) + "\n";

  if (details.mainRepositoryRoot && details.mainRepositoryRoot !== details.cwd) {
    reportText +=
      theme.fg("accent", "  repository: ") +
      theme.fg("dim", collapseHomeDirectory(details.mainRepositoryRoot, homeDirectoryPath)) +
      "\n";
  }

  if (details.configs.length === 0) {
    reportText += theme.fg("dim", "  (no matching workspace config)") + "\n";
    return reportText.trimEnd();
  }

  for (const item of details.configs) {
    reportText += formatConfigBlock(theme, item, homeDirectoryPath);
  }

  return reportText.trimEnd();
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

export function buildSystemPromptAppend(directories: readonly string[]): string {
  const promptSections: string[] = [];

  for (const directoryPath of directories) {
    const promptContent = readPromptFile(directoryPath);
    if (promptContent) {
      promptSections.push(`\n\n${promptContent}`);
    }
  }

  return promptSections.join("");
}

export async function workspaceExtension(pi: ExtensionAPI): Promise<void> {
  const initialCurrentDirectory = process.cwd();
  const initialConfig = loadEffectiveConfig(initialCurrentDirectory);
  const initialDirectories = resolveWorkspaceDirectories(initialCurrentDirectory, { config: initialConfig });
  const initialResourcePaths = getWorkspaceResourcePaths(initialDirectories);

  // 1. Register message renderer for startup status card
  pi.registerMessageRenderer(CONFIG_KEY, (message) => {
    const text =
      typeof message.content === "string"
        ? message.content
        : message.content
            .filter(isTextContentPart)
            .map((part) => part.text)
            .join("\n");

    return new Text(text, 0, 0);
  });

  // 2. Prevent custom report messages from entering LLM conversation context
  pi.on("context", async (event) => ({
    messages: event.messages.filter((message) => message.role !== "custom" || message.customType !== CONFIG_KEY),
  }));

  // 3. Dynamic extension loading during startup
  await loadWorkspaceExtensions(pi, initialResourcePaths.extensionPaths);

  // 4. Discover skills and prompt templates (commands)
  pi.on("resources_discover", async (event) => {
    const effectiveConfig = loadEffectiveConfig(event.cwd);
    const currentDirectories = resolveWorkspaceDirectories(event.cwd, { config: effectiveConfig });
    const resourcePaths = getWorkspaceResourcePaths(currentDirectories);

    return {
      skillPaths: resourcePaths.skillPaths,
      promptPaths: resourcePaths.promptPaths,
    };
  });

  // 5. Inject system prompt instructions verbatim without synthetic headers
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

  // 6. Apply workspace settings & display startup status card
  pi.on("session_start", async (_event, ctx) => {
    const effectiveConfig = loadEffectiveConfig(ctx.cwd);
    const currentDirectories = resolveWorkspaceDirectories(ctx.cwd, { config: effectiveConfig });

    const settingsToApply: IWorkspaceSettings[] = [];
    for (const directoryPath of currentDirectories) {
      const settings = readSettingsFile(directoryPath);
      if (settings) {
        settingsToApply.push(settings);
      }
    }

    await applyWorkspaceSettings(pi, ctx, settingsToApply);

    if (ctx.hasUI) {
      const matchedConfigs = resolveMatchedWorkspaceConfigs(ctx.cwd, { config: effectiveConfig });
      const mainRepositoryRoot = findMainRepositoryRoot(ctx.cwd);
      pi.sendMessage({
        customType: CONFIG_KEY,
        content: formatWorkspaceReport(ctx.ui.theme, {
          cwd: ctx.cwd,
          ...(mainRepositoryRoot !== undefined ? { mainRepositoryRoot } : {}),
          configs: matchedConfigs,
        }),
        display: true,
      });
    }
  });
}
