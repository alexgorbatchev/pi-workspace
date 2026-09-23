import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import type {
  DirectoryReaderFn,
  FileExistsFn,
  FileReaderFn,
  IWorkspaceConfig,
  IWorkspaceDirectoryAssets,
  IWorkspaceResourcePaths,
  IWorkspaceSettings,
  WorkspaceMappings,
} from "./types.js";

export const CONFIG_KEY = "@alexgorbatchev/pi-workspace";

export const PROMPT_FILE_NAMES = ["APPEND_SYSTEM.md", "SYSTEM.md", "AGENTS.md", "CLAUDE.md"] as const;

export interface IWorkspaceResolverOptions {
  readonly config?: IWorkspaceConfig | undefined;
  readonly homeDirectoryPath?: string | undefined;
  readonly fileExists?: FileExistsFn | undefined;
}

export interface IPatternMatch {
  readonly isMatch: boolean;
  readonly captures: readonly string[];
  readonly namedCaptures: Record<string, string>;
}

export function expandHomeDirectory(filePath: string, homeDirectoryPath: string = homedir()): string {
  if (filePath === "~") {
    return homeDirectoryPath;
  }
  if (filePath.startsWith(`~${sep}`) || filePath.startsWith("~/") || filePath.startsWith("~\\")) {
    return join(homeDirectoryPath, filePath.slice(2));
  }
  return filePath;
}

export function collapseHomeDirectory(filePath: string, homeDirectoryPath: string = homedir()): string {
  if (filePath === homeDirectoryPath) {
    return "~";
  }
  const prefix = homeDirectoryPath.endsWith(sep) ? homeDirectoryPath : `${homeDirectoryPath}${sep}`;
  if (filePath.startsWith(prefix)) {
    return `~/${filePath.slice(prefix.length).replaceAll("\\", "/")}`;
  }
  return filePath;
}

export function parseWorkspaceConfig(settings: unknown): IWorkspaceConfig | undefined {
  if (typeof settings !== "object" || settings === null) {
    return undefined;
  }

  const rawConfig = Reflect.get(settings, CONFIG_KEY);
  if (typeof rawConfig !== "object" || rawConfig === null) {
    return undefined;
  }

  const rawWorkspaces = Reflect.get(rawConfig, "workspaces");
  if (typeof rawWorkspaces !== "object" || rawWorkspaces === null || Array.isArray(rawWorkspaces)) {
    return undefined;
  }

  const workspaces: WorkspaceMappings = {};
  for (const [pattern, target] of Object.entries(rawWorkspaces)) {
    if (typeof target === "string" && target.trim().length > 0) {
      workspaces[pattern.trim()] = target.trim();
    } else if (Array.isArray(target)) {
      const validTargets = target
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
      if (validTargets.length > 0) {
        workspaces[pattern.trim()] = validTargets;
      }
    }
  }

  if (Object.keys(workspaces).length === 0) {
    return undefined;
  }

  return { workspaces };
}

function normalizePathSegments(inputPath: string, homeDirectoryPath?: string): string[] {
  const expanded = expandHomeDirectory(inputPath, homeDirectoryPath);
  return expanded.split(/[/\\]+/).filter((segment) => segment.length > 0 && segment !== ".");
}

export function matchWorkspacePattern(
  pattern: string,
  targetDirectory: string,
  homeDirectoryPath?: string,
): IPatternMatch {
  const patternSegments = normalizePathSegments(pattern, homeDirectoryPath);
  const targetSegments = normalizePathSegments(targetDirectory, homeDirectoryPath);

  if (targetSegments.length < patternSegments.length) {
    return { isMatch: false, captures: [], namedCaptures: {} };
  }

  const captures: string[] = [];
  const namedCaptures: Record<string, string> = {};

  for (let i = 0; i < patternSegments.length; i++) {
    const patternSegment = patternSegments[i] ?? "";
    const targetSegment = targetSegments[i] ?? "";

    if (patternSegment === "*") {
      captures.push(targetSegment);
    } else if (patternSegment.startsWith(":") && patternSegment.length > 1) {
      const paramName = patternSegment.slice(1);
      captures.push(targetSegment);
      namedCaptures[paramName] = targetSegment;
    } else if (patternSegment.toLowerCase() !== targetSegment.toLowerCase()) {
      return { isMatch: false, captures: [], namedCaptures: {} };
    }
  }

  return {
    isMatch: true,
    captures,
    namedCaptures,
  };
}

export function interpolateTargetTemplate(template: string, match: IPatternMatch): string {
  let result = template;

  for (let i = 0; i < match.captures.length; i++) {
    const captureValue = match.captures[i] ?? "";
    const numericPlaceholder = `:${i + 1}`;
    const dollarPlaceholder = `$${i + 1}`;
    result = result.replaceAll(numericPlaceholder, captureValue).replaceAll(dollarPlaceholder, captureValue);
  }

  for (const [name, value] of Object.entries(match.namedCaptures)) {
    result = result.replaceAll(`:${name}`, value);
  }

  return result;
}

function sortPatternsBySpecificity(patterns: readonly string[]): string[] {
  return [...patterns].sort((firstPattern, secondPattern) => {
    const firstHasWildcard = firstPattern.includes("*") || firstPattern.includes(":");
    const secondHasWildcard = secondPattern.includes("*") || secondPattern.includes(":");

    if (!firstHasWildcard && secondHasWildcard) return -1;
    if (firstHasWildcard && !secondHasWildcard) return 1;

    return secondPattern.length - firstPattern.length;
  });
}

export function resolveWorkspaceDirectories(
  currentWorkingDirectory: string,
  options?: IWorkspaceResolverOptions,
): string[] {
  const workspacesConfig = options?.config?.workspaces;
  if (!workspacesConfig || Object.keys(workspacesConfig).length === 0) {
    return [];
  }

  const checkFileExists = options?.fileExists ?? existsSync;
  const sortedPatterns = sortPatternsBySpecificity(Object.keys(workspacesConfig));

  for (const pattern of sortedPatterns) {
    const match = matchWorkspacePattern(pattern, currentWorkingDirectory, options?.homeDirectoryPath);
    if (match.isMatch) {
      const rawTargets = workspacesConfig[pattern];
      const targetTemplates = Array.isArray(rawTargets) ? rawTargets : rawTargets ? [rawTargets] : [];

      const resolvedDirectories: string[] = [];
      for (const template of targetTemplates) {
        const interpolated = interpolateTargetTemplate(template, match);
        const expanded = expandHomeDirectory(interpolated, options?.homeDirectoryPath);
        const resolvedPath = resolve(expanded);

        if (checkFileExists(resolvedPath) && !resolvedDirectories.includes(resolvedPath)) {
          resolvedDirectories.push(resolvedPath);
        }
      }

      return resolvedDirectories;
    }
  }

  return [];
}

export function findPromptFile(directoryPath: string, checkFileExists: FileExistsFn = existsSync): string | null {
  for (const candidateName of PROMPT_FILE_NAMES) {
    const candidatePath = join(directoryPath, candidateName);
    if (checkFileExists(candidatePath)) {
      return candidatePath;
    }
  }
  return null;
}

export function readPromptFile(
  directoryPath: string,
  checkFileExists: FileExistsFn = existsSync,
  fileReader: FileReaderFn = (filePath) => readFileSync(filePath, "utf-8"),
): string | null {
  const promptFilePath = findPromptFile(directoryPath, checkFileExists);
  if (!promptFilePath) {
    return null;
  }

  try {
    const content = fileReader(promptFilePath).trim();
    return content.length > 0 ? content : null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[pi-workspace] Failed to read prompt file ${promptFilePath}: ${message}`);
    return null;
  }
}

export function readSettingsFile(
  directoryPath: string,
  checkFileExists: FileExistsFn = existsSync,
  fileReader: FileReaderFn = (filePath) => readFileSync(filePath, "utf-8"),
): IWorkspaceSettings | null {
  const settingsFilePath = join(directoryPath, "settings.json");
  if (!checkFileExists(settingsFilePath)) {
    return null;
  }

  try {
    const rawContent = fileReader(settingsFilePath);
    const parsedData: unknown = JSON.parse(rawContent);
    if (typeof parsedData !== "object" || parsedData === null) {
      return null;
    }

    let defaultTools: string[] | undefined;
    const rawTools = Reflect.get(parsedData, "defaultTools");
    if (Array.isArray(rawTools)) {
      const validTools = rawTools
        .filter((tool): tool is string => typeof tool === "string")
        .map((tool) => tool.trim())
        .filter((tool) => tool.length > 0);
      if (validTools.length > 0) {
        defaultTools = validTools;
      }
    }

    let defaultThinkingLevel: string | undefined;
    const rawThinking = Reflect.get(parsedData, "defaultThinkingLevel");
    if (typeof rawThinking === "string" && rawThinking.trim().length > 0) {
      defaultThinkingLevel = rawThinking.trim();
    }

    let defaultModel: string | undefined;
    const rawModel = Reflect.get(parsedData, "defaultModel");
    if (typeof rawModel === "string" && rawModel.trim().length > 0) {
      defaultModel = rawModel.trim();
    }

    if (defaultTools === undefined && defaultThinkingLevel === undefined && defaultModel === undefined) {
      return null;
    }

    return {
      ...(defaultTools !== undefined ? { defaultTools } : {}),
      ...(defaultThinkingLevel !== undefined ? { defaultThinkingLevel } : {}),
      ...(defaultModel !== undefined ? { defaultModel } : {}),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[pi-workspace] Failed to parse settings file ${settingsFilePath}: ${message}`);
    return null;
  }
}

export function getDirectoryAssets(
  directoryPath: string,
  checkFileExists: FileExistsFn = existsSync,
  directoryReader: DirectoryReaderFn = (dirPath) => readdirSync(dirPath),
): IWorkspaceDirectoryAssets {
  const promptPath = findPromptFile(directoryPath, checkFileExists);
  const promptFileName = promptPath ? basename(promptPath) : undefined;

  const skillNames: string[] = [];
  const skillsSubdirectory = join(directoryPath, "skills");
  if (checkFileExists(skillsSubdirectory)) {
    try {
      const entries = directoryReader(skillsSubdirectory);
      for (const entry of entries) {
        const skillFilePath = join(skillsSubdirectory, entry, "SKILL.md");
        if (checkFileExists(skillFilePath) || entry.endsWith(".md")) {
          const skillName = entry.replace(/\.md$/, "");
          if (!skillNames.includes(skillName)) {
            skillNames.push(skillName);
          }
        }
      }
    } catch {
      // Ignore unreadable skills directory
    }
  }

  const promptNames: string[] = [];
  const promptsSubdirectory = join(directoryPath, "prompts");
  if (checkFileExists(promptsSubdirectory)) {
    try {
      const entries = directoryReader(promptsSubdirectory);
      for (const entry of entries) {
        if (entry.endsWith(".md")) {
          const commandName = entry.slice(0, -3);
          if (!promptNames.includes(commandName)) {
            promptNames.push(commandName);
          }
        }
      }
    } catch {
      // Ignore unreadable prompts directory
    }
  }

  const extensionFileNames: string[] = [];
  const extensionsSubdirectory = join(directoryPath, "extensions");
  if (checkFileExists(extensionsSubdirectory)) {
    try {
      const entries = directoryReader(extensionsSubdirectory);
      for (const entry of entries) {
        const isSupportedScript =
          (entry.endsWith(".ts") || entry.endsWith(".js")) &&
          !entry.endsWith(".d.ts") &&
          !entry.endsWith(".test.ts") &&
          !entry.endsWith(".spec.ts");
        if (isSupportedScript && !extensionFileNames.includes(entry)) {
          extensionFileNames.push(entry);
        }
      }
    } catch {
      // Ignore unreadable extensions directory
    }
  }

  return {
    directoryPath,
    ...(promptFileName !== undefined ? { promptFileName } : {}),
    skillNames,
    promptNames,
    extensionFileNames,
  };
}

export function getWorkspaceResourcePaths(
  directories: readonly string[],
  checkFileExists: FileExistsFn = existsSync,
  directoryReader: DirectoryReaderFn = (dirPath) => readdirSync(dirPath),
): IWorkspaceResourcePaths {
  const skillPaths: string[] = [];
  const promptPaths: string[] = [];
  const extensionPaths: string[] = [];

  for (const directoryPath of directories) {
    const skillsSubdirectory = join(directoryPath, "skills");
    if (checkFileExists(skillsSubdirectory) && !skillPaths.includes(skillsSubdirectory)) {
      skillPaths.push(skillsSubdirectory);
    }

    const promptsSubdirectory = join(directoryPath, "prompts");
    if (checkFileExists(promptsSubdirectory) && !promptPaths.includes(promptsSubdirectory)) {
      promptPaths.push(promptsSubdirectory);
    }

    const extensionsSubdirectory = join(directoryPath, "extensions");
    if (checkFileExists(extensionsSubdirectory)) {
      try {
        const fileNames = directoryReader(extensionsSubdirectory);
        for (const fileName of fileNames) {
          const isSupportedScript =
            (fileName.endsWith(".ts") || fileName.endsWith(".js")) &&
            !fileName.endsWith(".d.ts") &&
            !fileName.endsWith(".test.ts") &&
            !fileName.endsWith(".spec.ts");
          if (isSupportedScript) {
            const extensionFilePath = join(extensionsSubdirectory, fileName);
            if (!extensionPaths.includes(extensionFilePath)) {
              extensionPaths.push(extensionFilePath);
            }
          }
        }
      } catch (error) {
        console.error(`[pi-workspace] Failed to read extensions directory ${extensionsSubdirectory}:`, error);
      }
    }
  }

  return {
    skillPaths,
    promptPaths,
    extensionPaths,
  };
}
