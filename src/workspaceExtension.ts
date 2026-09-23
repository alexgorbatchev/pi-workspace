import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type {
  ExtensionImporterFn,
  IModelRegistryLookup,
  ISettingsContext,
  IThemeFormatter,
  IWorkspaceConfig,
  IWorkspaceDirectories,
  IWorkspaceReportDetails,
  IWorkspaceSettings,
  IWorkspaceTierAssets,
  WorkspaceTierType,
} from "./types.js";
import {
  collapseHomeDirectory,
  CONFIG_KEY,
  getTierAssets,
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

function formatAssetList(theme: IThemeFormatter, label: string, items: readonly string[]): string {
  if (items.length === 0) {
    return "";
  }
  const sortedItems = [...items].sort((firstItem, secondItem) => firstItem.localeCompare(secondItem));
  let result = theme.fg("accent", `    ${label}:`) + "\n";
  for (const item of sortedItems) {
    result += theme.fg("dim", `      - ${item}`) + "\n";
  }
  return result;
}

function formatTierSection(
  theme: IThemeFormatter,
  tierType: WorkspaceTierType,
  tier: IWorkspaceTierAssets,
  homeDirectoryPath?: string,
): string {
  const displayPath = collapseHomeDirectory(tier.directoryPath, homeDirectoryPath);
  let sectionText = theme.fg("accent", `  ${tierType}: `) + theme.fg("dim", `${tier.name} (${displayPath})`) + "\n";

  let hasContributions = false;
  if (tier.promptFileName) {
    sectionText += theme.fg("accent", "    prompt: ") + theme.fg("dim", tier.promptFileName) + "\n";
    hasContributions = true;
  }
  if (tier.skillNames.length > 0) {
    sectionText += formatAssetList(theme, "skills", tier.skillNames);
    hasContributions = true;
  }
  if (tier.promptNames.length > 0) {
    sectionText += formatAssetList(theme, "commands", tier.promptNames);
    hasContributions = true;
  }
  if (tier.extensionFileNames.length > 0) {
    sectionText += formatAssetList(theme, "extensions", tier.extensionFileNames);
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
    theme.fg("accent", "  root: ") +
    theme.fg("dim", collapseHomeDirectory(details.workspacesRoot, homeDirectoryPath)) +
    "\n";
  reportText +=
    theme.fg("accent", "  base: ") + theme.fg("dim", collapseHomeDirectory(details.baseDir, homeDirectoryPath)) + "\n";

  if (details.org) {
    reportText += formatTierSection(theme, "organization", details.org, homeDirectoryPath);
  }
  if (details.project) {
    reportText += formatTierSection(theme, "project", details.project, homeDirectoryPath);
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

function buildReportDetails(
  cwd: string,
  effectiveConfig: IWorkspaceConfig | undefined,
  currentDirectories: IWorkspaceDirectories,
): IWorkspaceReportDetails {
  const orgTierAssets = currentDirectories.orgDirectory
    ? getTierAssets(currentDirectories.orgName ?? "organization", currentDirectories.orgDirectory)
    : undefined;

  const projectTierAssets = currentDirectories.projectDirectory
    ? getTierAssets(currentDirectories.projectName ?? "project", currentDirectories.projectDirectory)
    : undefined;

  return {
    workspacesRoot: resolveWorkspacesRoot({ config: effectiveConfig }),
    baseDir: resolveBaseDir({ config: effectiveConfig }),
    ...(orgTierAssets !== undefined ? { org: orgTierAssets } : {}),
    ...(projectTierAssets !== undefined ? { project: projectTierAssets } : {}),
  };
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

  // 5. Inject system prompt instructions
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

    if (ctx.hasUI) {
      const reportDetails = buildReportDetails(ctx.cwd, effectiveConfig, currentDirectories);
      pi.sendMessage({
        customType: CONFIG_KEY,
        content: formatWorkspaceReport(ctx.ui.theme, reportDetails),
        display: true,
      });
    }
  });
}
