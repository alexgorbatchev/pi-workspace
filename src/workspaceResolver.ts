import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, normalize, relative, resolve, sep } from "node:path";
import type {
  DirectoryReaderFn,
  FileExistsFn,
  FileReaderFn,
  IWorkspaceConfig,
  IWorkspaceDirectories,
  IWorkspaceResourcePaths,
  IWorkspaceSettings,
  IWorkspaceTierAssets,
} from "./types.js";

export const CONFIG_KEY = "@alexgorbatchev/pi-workspace";

export const DEFAULT_WORKSPACES_ROOT = "~/.pi/agent/workspaces";
export const DEFAULT_BASE_DIR = "~/development";

export const PROMPT_FILE_NAMES = ["APPEND_SYSTEM.md", "SYSTEM.md", "AGENTS.md", "CLAUDE.md"] as const;

export interface IWorkspaceResolverOptions {
  readonly config?: IWorkspaceConfig | undefined;
  readonly env?: Record<string, string | undefined> | undefined;
  readonly homeDirectoryPath?: string | undefined;
  readonly fileExists?: FileExistsFn | undefined;
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

export function resolveWorkspacesRoot(options?: IWorkspaceResolverOptions): string {
  const envValue = options?.env !== undefined ? options.env.PI_WORKSPACES_ROOT : process.env.PI_WORKSPACES_ROOT;
  const configValue = options?.config?.workspacesRoot;
  const rawPath = envValue ?? configValue ?? DEFAULT_WORKSPACES_ROOT;
  const expandedPath = expandHomeDirectory(rawPath, options?.homeDirectoryPath);
  return resolve(expandedPath);
}

export function resolveBaseDir(options?: IWorkspaceResolverOptions): string {
  const envValue = options?.env !== undefined ? options.env.PI_WORKSPACE_BASE_DIR : process.env.PI_WORKSPACE_BASE_DIR;
  const configValue = options?.config?.baseDir;
  const rawPath = envValue ?? configValue ?? DEFAULT_BASE_DIR;
  const expandedPath = expandHomeDirectory(rawPath, options?.homeDirectoryPath);
  return resolve(expandedPath);
}

export function parseWorkspaceConfig(settings: unknown): IWorkspaceConfig | undefined {
  if (typeof settings !== "object" || settings === null) {
    return undefined;
  }

  const rawConfig = Reflect.get(settings, CONFIG_KEY);
  if (typeof rawConfig !== "object" || rawConfig === null) {
    return undefined;
  }

  let workspacesRoot: string | undefined;
  const rawWorkspacesRoot = Reflect.get(rawConfig, "workspacesRoot");
  if (typeof rawWorkspacesRoot === "string" && rawWorkspacesRoot.trim().length > 0) {
    workspacesRoot = rawWorkspacesRoot.trim();
  }

  let baseDir: string | undefined;
  const rawBaseDir = Reflect.get(rawConfig, "baseDir");
  if (typeof rawBaseDir === "string" && rawBaseDir.trim().length > 0) {
    baseDir = rawBaseDir.trim();
  }

  let mappings: Record<string, string> | undefined;
  const rawMappings = Reflect.get(rawConfig, "mappings");
  if (typeof rawMappings === "object" && rawMappings !== null && !Array.isArray(rawMappings)) {
    const validMappings: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawMappings)) {
      if (typeof value === "string" && value.trim().length > 0) {
        validMappings[key] = value.trim();
      }
    }
    if (Object.keys(validMappings).length > 0) {
      mappings = validMappings;
    }
  }

  if (workspacesRoot === undefined && baseDir === undefined && mappings === undefined) {
    return undefined;
  }

  return {
    ...(workspacesRoot !== undefined ? { workspacesRoot } : {}),
    ...(baseDir !== undefined ? { baseDir } : {}),
    ...(mappings !== undefined ? { mappings } : {}),
  };
}

function resolveOrgDirectoryPath(workspacesRootPath: string, orgName: string, checkFileExists: FileExistsFn): string {
  const primaryCommonPath = join(workspacesRootPath, orgName, "_common");
  if (checkFileExists(primaryCommonPath)) {
    return primaryCommonPath;
  }

  const secondaryCommonPath = join(workspacesRootPath, orgName, "common");
  if (checkFileExists(secondaryCommonPath)) {
    return secondaryCommonPath;
  }

  const directOrgPath = join(workspacesRootPath, orgName);
  if (checkFileExists(directOrgPath)) {
    return directOrgPath;
  }

  return primaryCommonPath;
}

export function resolveWorkspaceDirectories(
  currentWorkingDirectory: string,
  options?: IWorkspaceResolverOptions,
): IWorkspaceDirectories {
  const checkFileExists = options?.fileExists ?? existsSync;
  const workspacesRootPath = resolveWorkspacesRoot(options);
  const baseDirectoryPath = resolveBaseDir(options);
  const resolvedCurrentDirectory = resolve(currentWorkingDirectory);

  const mappings = options?.config?.mappings ?? {};
  for (const [mappedSourcePath, targetRelativePath] of Object.entries(mappings)) {
    const resolvedMappedPath = resolve(expandHomeDirectory(mappedSourcePath, options?.homeDirectoryPath));
    if (resolvedCurrentDirectory === resolvedMappedPath) {
      const parts = normalize(targetRelativePath)
        .split(/[/\\]+/)
        .filter((part) => part.length > 0);
      if (parts.length >= 2) {
        const orgName = parts[0] ?? "";
        const projectName = parts.slice(1).join("/");
        const orgDirectory = resolveOrgDirectoryPath(workspacesRootPath, orgName, checkFileExists);
        const projectDirectory = join(workspacesRootPath, orgName, projectName);
        return { orgDirectory, projectDirectory, orgName, projectName };
      }
      if (parts.length === 1) {
        const projectName = parts[0] ?? "";
        const projectDirectory = join(workspacesRootPath, projectName);
        return { projectDirectory, projectName };
      }
    }
  }

  const isUnderBaseDirectory =
    resolvedCurrentDirectory === baseDirectoryPath ||
    resolvedCurrentDirectory.startsWith(
      baseDirectoryPath.endsWith(sep) ? baseDirectoryPath : `${baseDirectoryPath}${sep}`,
    );

  if (isUnderBaseDirectory && resolvedCurrentDirectory !== baseDirectoryPath) {
    const relativePath = relative(baseDirectoryPath, resolvedCurrentDirectory);
    const parts = relativePath.split(sep).filter((part) => part.length > 0);

    if (parts.length >= 2) {
      const orgName = parts[0] ?? "";
      const projectName = parts.slice(1).join("/");
      const orgDirectory = resolveOrgDirectoryPath(workspacesRootPath, orgName, checkFileExists);
      const projectDirectory = join(workspacesRootPath, orgName, projectName);
      return { orgDirectory, projectDirectory, orgName, projectName };
    }

    if (parts.length === 1) {
      const projectName = parts[0] ?? "";
      const projectDirectory = join(workspacesRootPath, projectName);
      return { projectDirectory, projectName };
    }
  }

  const fallbackProjectName = basename(resolvedCurrentDirectory);
  const fallbackProjectDirectory = join(workspacesRootPath, fallbackProjectName);
  return {
    projectDirectory: fallbackProjectDirectory,
    projectName: fallbackProjectName,
  };
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

export function getTierAssets(
  name: string,
  directoryPath: string,
  checkFileExists: FileExistsFn = existsSync,
  directoryReader: DirectoryReaderFn = (dirPath) => readdirSync(dirPath),
): IWorkspaceTierAssets {
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
      // Ignore unreadable skills directories
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
      // Ignore unreadable prompts directories
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
      // Ignore unreadable extensions directories
    }
  }

  return {
    name,
    directoryPath,
    ...(promptFileName !== undefined ? { promptFileName } : {}),
    skillNames,
    promptNames,
    extensionFileNames,
  };
}

export function getWorkspaceResourcePaths(
  directories: IWorkspaceDirectories,
  checkFileExists: FileExistsFn = existsSync,
  directoryReader: DirectoryReaderFn = (dirPath) => readdirSync(dirPath),
): IWorkspaceResourcePaths {
  const skillPaths: string[] = [];
  const promptPaths: string[] = [];
  const extensionPaths: string[] = [];

  const directoryOrder: string[] = [];
  if (directories.projectDirectory) {
    directoryOrder.push(directories.projectDirectory);
  }
  if (directories.orgDirectory && directories.orgDirectory !== directories.projectDirectory) {
    directoryOrder.push(directories.orgDirectory);
  }

  for (const directoryPath of directoryOrder) {
    const skillsSubdirectory = join(directoryPath, "skills");
    if (checkFileExists(skillsSubdirectory) && !skillPaths.includes(skillsSubdirectory)) {
      skillPaths.push(skillsSubdirectory);
    }

    const promptsSubdirectory = join(directoryPath, "prompts");
    if (checkFileExists(promptsSubdirectory) && !promptPaths.includes(promptsSubdirectory)) {
      promptPaths.push(promptsSubdirectory);
    }
  }

  // Extensions load order: org first, then project overrides
  const extensionDirectoryOrder: string[] = [];
  if (directories.orgDirectory) {
    extensionDirectoryOrder.push(directories.orgDirectory);
  }
  if (directories.projectDirectory && directories.projectDirectory !== directories.orgDirectory) {
    extensionDirectoryOrder.push(directories.projectDirectory);
  }

  for (const directoryPath of extensionDirectoryOrder) {
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
