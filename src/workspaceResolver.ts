import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve, sep } from "node:path";
import type {
  DirectoryReaderFn,
  FileExistsFn,
  FileReaderFn,
  IWorkspaceConfig,
  IWorkspaceMatchedConfig,
  IWorkspaceResourcePaths,
  IWorkspaceRule,
  IWorkspaceSettings,
  WorkspaceRulePath,
} from "./types.js";

export const CONFIG_KEY = "@alexgorbatchev/pi-workspace";

export const PROMPT_FILE_NAMES = ["APPEND_SYSTEM.md", "SYSTEM.md", "AGENTS.md", "CLAUDE.md"] as const;

export interface IWorkspaceResolverOptions {
  readonly config?: IWorkspaceConfig | undefined;
  readonly homeDirectoryPath?: string | undefined;
  readonly fileExists?: FileExistsFn | undefined;
  readonly directoryReader?: DirectoryReaderFn | undefined;
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

function parseRulePath(rawPath: unknown): WorkspaceRulePath | undefined {
  if (typeof rawPath === "string" && rawPath.trim().length > 0) {
    return rawPath.trim();
  }
  if (Array.isArray(rawPath)) {
    const validPaths = rawPath
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    if (validPaths.length > 0) {
      return validPaths;
    }
  }
  return undefined;
}

export function parseWorkspaceConfig(settings: unknown): IWorkspaceConfig | undefined {
  if (typeof settings !== "object" || settings === null) {
    return undefined;
  }

  const rawConfig = Reflect.get(settings, CONFIG_KEY);
  if (typeof rawConfig !== "object" || rawConfig === null) {
    return undefined;
  }

  const rules: IWorkspaceRule[] = [];

  const rawConfigs = Reflect.get(rawConfig, "configs");
  if (Array.isArray(rawConfigs)) {
    for (const entry of rawConfigs) {
      if (typeof entry === "object" && entry !== null) {
        const rawGlob = Reflect.get(entry, "glob");
        const rawPath = Reflect.get(entry, "path");
        if (typeof rawGlob === "string" && rawGlob.trim().length > 0) {
          const parsedPath = parseRulePath(rawPath);
          if (parsedPath !== undefined) {
            rules.push({ glob: rawGlob.trim(), path: parsedPath });
          }
        }
      }
    }
  }

  const rawWorkspaces = Reflect.get(rawConfig, "workspaces");
  if (typeof rawWorkspaces === "object" && rawWorkspaces !== null && !Array.isArray(rawWorkspaces)) {
    for (const [glob, rawPath] of Object.entries(rawWorkspaces)) {
      if (typeof glob === "string" && glob.trim().length > 0) {
        const parsedPath = parseRulePath(rawPath);
        if (parsedPath !== undefined) {
          rules.push({ glob: glob.trim(), path: parsedPath });
        }
      }
    }
  }

  if (rules.length === 0) {
    return undefined;
  }

  return { configs: rules };
}

function normalizePathSegments(inputPath: string, homeDirectoryPath?: string): string[] {
  const expanded = expandHomeDirectory(inputPath, homeDirectoryPath);
  const resolved = isAbsolute(expanded) ? expanded : resolve(expanded);
  return resolved.split(/[/\\]+/).filter((segment) => segment.length > 0 && segment !== ".");
}

export function matchWorkspacePattern(pattern: string, targetDirectory: string, homeDirectoryPath?: string): boolean {
  const patternSegments = normalizePathSegments(pattern, homeDirectoryPath);
  const targetSegments = normalizePathSegments(targetDirectory, homeDirectoryPath);

  if (targetSegments.length < patternSegments.length) {
    return false;
  }

  for (let i = 0; i < patternSegments.length; i++) {
    const patternSegment = patternSegments[i] ?? "";
    const targetSegment = targetSegments[i] ?? "";

    if (patternSegment === "*") {
      continue;
    }
    if (patternSegment.toLowerCase() !== targetSegment.toLowerCase()) {
      return false;
    }
  }

  return true;
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

export interface IDirectoryAssetScan {
  readonly promptFileName?: string | undefined;
  readonly skillNames: string[];
  readonly promptNames: string[];
  readonly extensionFileNames: string[];
}

export function scanDirectoryAssets(
  directoryPath: string,
  checkFileExists: FileExistsFn = existsSync,
  directoryReader: DirectoryReaderFn = (dirPath) => readdirSync(dirPath),
): IDirectoryAssetScan {
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
    ...(promptFileName !== undefined ? { promptFileName } : {}),
    skillNames,
    promptNames,
    extensionFileNames,
  };
}

export function resolveMatchedWorkspaceConfigs(
  currentWorkingDirectory: string,
  options?: IWorkspaceResolverOptions,
): IWorkspaceMatchedConfig[] {
  const rules = options?.config?.configs;
  if (!rules || rules.length === 0) {
    return [];
  }

  const checkFileExists = options?.fileExists ?? existsSync;
  const directoryReader = options?.directoryReader ?? readdirSync;
  const matchedList: IWorkspaceMatchedConfig[] = [];

  for (const rule of rules) {
    if (matchWorkspacePattern(rule.glob, currentWorkingDirectory, options?.homeDirectoryPath)) {
      const targetPaths = Array.isArray(rule.path) ? rule.path : [rule.path];

      for (const rawPath of targetPaths) {
        const expanded = expandHomeDirectory(rawPath, options?.homeDirectoryPath);
        const resolvedDirectory = resolve(expanded);

        if (checkFileExists(resolvedDirectory)) {
          const scan = scanDirectoryAssets(resolvedDirectory, checkFileExists, directoryReader);
          matchedList.push({
            glob: rule.glob,
            directoryPath: resolvedDirectory,
            ...(scan.promptFileName !== undefined ? { promptFileName: scan.promptFileName } : {}),
            skillNames: scan.skillNames,
            promptNames: scan.promptNames,
            extensionFileNames: scan.extensionFileNames,
          });
        }
      }
    }
  }

  return matchedList;
}

export function resolveWorkspaceDirectories(
  currentWorkingDirectory: string,
  options?: IWorkspaceResolverOptions,
): string[] {
  const matched = resolveMatchedWorkspaceConfigs(currentWorkingDirectory, options);
  const directories: string[] = [];
  for (const item of matched) {
    if (!directories.includes(item.directoryPath)) {
      directories.push(item.directoryPath);
    }
  }
  return directories;
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
