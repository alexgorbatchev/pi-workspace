import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import type {
  DirectoryReaderFn,
  FileExistsFn,
  FileReaderFn,
  GitConfigReaderFn,
  IWorkspaceConfig,
  IWorkspaceMatchedConfig,
  IWorkspaceResourcePaths,
  IWorkspaceRule,
  IWorkspaceSettings,
  WorkspaceRuleLoad,
} from "./types.js";

export const CONFIG_KEY = "@alexgorbatchev/pi-workspace";

export const GIT_CONFIG_CONFIG_KEY = "pi-workspace.config";
export const GIT_CONFIG_KEY = "pi-workspace.load";
export const GIT_CONFIG_PATH_KEY = "pi-workspace.path";

export const PROMPT_FILE_NAMES = ["APPEND_SYSTEM.md", "SYSTEM.md", "AGENTS.md", "CLAUDE.md"] as const;

export interface IWorkspaceResolverOptions {
  readonly config?: IWorkspaceConfig | undefined;
  readonly homeDirectoryPath?: string | undefined;
  readonly fileExists?: FileExistsFn | undefined;
  readonly directoryReader?: DirectoryReaderFn | undefined;
  readonly fileReader?: FileReaderFn | undefined;
  readonly gitConfigReader?: GitConfigReaderFn | undefined;
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

function parseRuleLoad(rawLoad: unknown): WorkspaceRuleLoad | undefined {
  if (typeof rawLoad === "string" && rawLoad.trim().length > 0) {
    return rawLoad.trim();
  }
  if (Array.isArray(rawLoad)) {
    const validPaths = rawLoad
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

  const rawConfig = Array.isArray(settings) ? { configs: settings } : (Reflect.get(settings, CONFIG_KEY) ?? settings);
  if (typeof rawConfig !== "object" || rawConfig === null) {
    return undefined;
  }

  const rules: IWorkspaceRule[] = [];

  const rawConfigs = Reflect.get(rawConfig, "configs");
  if (Array.isArray(rawConfigs)) {
    for (const entry of rawConfigs) {
      if (typeof entry === "object" && entry !== null) {
        const rawWhen = Reflect.get(entry, "when") ?? Reflect.get(entry, "glob");
        const rawLoad = Reflect.get(entry, "load") ?? Reflect.get(entry, "path");
        if (typeof rawWhen === "string" && rawWhen.trim().length > 0) {
          const parsedLoad = parseRuleLoad(rawLoad);
          if (parsedLoad !== undefined) {
            rules.push({ when: rawWhen.trim(), load: parsedLoad });
          }
        }
      }
    }
  }

  const rawWorkspaces = Reflect.get(rawConfig, "workspaces");
  if (typeof rawWorkspaces === "object" && rawWorkspaces !== null && !Array.isArray(rawWorkspaces)) {
    for (const [when, rawLoad] of Object.entries(rawWorkspaces)) {
      if (typeof when === "string" && when.trim().length > 0) {
        const parsedLoad = parseRuleLoad(rawLoad);
        if (parsedLoad !== undefined) {
          rules.push({ when: when.trim(), load: parsedLoad });
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

export function findMainRepositoryRoot(startDirectory: string): string | undefined {
  let currentDirectory = resolve(startDirectory);

  while (true) {
    const gitPath = join(currentDirectory, ".git");
    if (existsSync(gitPath)) {
      try {
        const stats = statSync(gitPath);
        if (stats.isDirectory()) {
          return currentDirectory;
        }
        if (stats.isFile()) {
          const content = readFileSync(gitPath, "utf-8").trim();
          const match = content.match(/^gitdir:\s*(.+)$/m);
          if (match && match[1]) {
            const gitDir = resolve(currentDirectory, match[1].trim());
            const commonDirFile = join(gitDir, "commondir");
            if (existsSync(commonDirFile)) {
              const commonDirRelative = readFileSync(commonDirFile, "utf-8").trim();
              const commonDir = resolve(gitDir, commonDirRelative);
              return dirname(commonDir);
            }
            return resolve(gitDir, "../../..");
          }
        }
      } catch {
        // Ignore unreadable .git entries
      }
    }

    const parentDirectory = dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      break;
    }
    currentDirectory = parentDirectory;
  }

  return undefined;
}

function stripGitComment(line: string): string {
  let isInDoubleQuote = false;
  let isInSingleQuote = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' && !isInSingleQuote) {
      isInDoubleQuote = !isInDoubleQuote;
    } else if (char === "'" && !isInDoubleQuote) {
      isInSingleQuote = !isInSingleQuote;
    } else if ((char === "#" || char === ";") && !isInDoubleQuote && !isInSingleQuote) {
      return line.slice(0, i).trim();
    }
  }

  return line.trim();
}

export function parseGitConfigLoads(configContent: string): string[] {
  const lines = configContent.split(/\r?\n/);
  let isInPiWorkspaceSection = false;
  const configValues: string[] = [];
  const loadValues: string[] = [];
  const pathValues: string[] = [];

  for (const rawLine of lines) {
    const cleanLine = stripGitComment(rawLine);
    if (cleanLine.length === 0) {
      continue;
    }

    const sectionMatch = cleanLine.match(/^\[\s*([a-zA-Z0-9_\-.]+)(?:\s+.*)?\]$/);
    if (sectionMatch) {
      const sectionName = sectionMatch[1] ?? "";
      isInPiWorkspaceSection = sectionName.toLowerCase() === "pi-workspace";
      continue;
    }

    if (!isInPiWorkspaceSection) {
      continue;
    }

    const keyValueMatch = cleanLine.match(/^([a-zA-Z0-9_-]+)\s*=\s*(.+)$/);
    if (keyValueMatch) {
      const keyName = (keyValueMatch[1] ?? "").toLowerCase();
      let rawValue = (keyValueMatch[2] ?? "").trim();

      if (
        (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
        (rawValue.startsWith("'") && rawValue.endsWith("'"))
      ) {
        rawValue = rawValue.slice(1, -1).trim();
      }

      const pathSegments = rawValue
        .split(",")
        .map((segment) => segment.trim())
        .filter((segment) => segment.length > 0);

      if (keyName === "config") {
        for (const segment of pathSegments) {
          configValues.push(segment);
        }
      } else if (keyName === "load") {
        for (const segment of pathSegments) {
          loadValues.push(segment);
        }
      } else if (keyName === "path") {
        for (const segment of pathSegments) {
          pathValues.push(segment);
        }
      }
    }
  }

  if (configValues.length > 0) {
    return configValues;
  }
  return loadValues.length > 0 ? loadValues : pathValues;
}

export function readGitConfigLoads(repositoryRoot: string, options?: IWorkspaceResolverOptions): string[] {
  if (options?.gitConfigReader) {
    return options.gitConfigReader(repositoryRoot);
  }

  // 1. Try Git CLI first if in a real git environment
  try {
    const output = execFileSync("git", ["config", "--get-all", GIT_CONFIG_CONFIG_KEY], {
      cwd: repositoryRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const parsedConfigs: string[] = [];
    const lines = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    for (const line of lines) {
      const splitItems = line
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
      for (const item of splitItems) {
        parsedConfigs.push(item);
      }
    }
    if (parsedConfigs.length > 0) {
      return parsedConfigs;
    }
  } catch {
    // CLI not available or key not found
  }

  try {
    const output = execFileSync("git", ["config", "--get-all", GIT_CONFIG_KEY], {
      cwd: repositoryRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const parsedLoads: string[] = [];
    const lines = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    for (const line of lines) {
      const splitItems = line
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
      for (const item of splitItems) {
        parsedLoads.push(item);
      }
    }
    if (parsedLoads.length > 0) {
      return parsedLoads;
    }
  } catch {
    // CLI not available or key not found
  }

  try {
    const output = execFileSync("git", ["config", "--get-all", GIT_CONFIG_PATH_KEY], {
      cwd: repositoryRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const parsedPaths: string[] = [];
    const lines = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    for (const line of lines) {
      const splitItems = line
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
      for (const item of splitItems) {
        parsedPaths.push(item);
      }
    }
    if (parsedPaths.length > 0) {
      return parsedPaths;
    }
  } catch {
    // CLI not available or key not found
  }

  // 2. Direct filesystem read fallback (works in mock/isolated test environments)
  const checkFileExists = options?.fileExists ?? existsSync;
  const fileReader = options?.fileReader ?? ((filePath) => readFileSync(filePath, "utf-8"));

  // Check worktree config if in a linked worktree
  const gitPath = join(repositoryRoot, ".git");
  if (checkFileExists(gitPath)) {
    try {
      const stats = statSync(gitPath);
      if (stats.isFile()) {
        const content = fileReader(gitPath).trim();
        const match = content.match(/^gitdir:\s*(.+)$/m);
        if (match && match[1]) {
          const gitDir = resolve(repositoryRoot, match[1].trim());
          const worktreeConfigPath = join(gitDir, "config.worktree");
          if (checkFileExists(worktreeConfigPath)) {
            const worktreeContent = fileReader(worktreeConfigPath);
            const worktreeLoads = parseGitConfigLoads(worktreeContent);
            if (worktreeLoads.length > 0) {
              return worktreeLoads;
            }
          }
        }
      }
    } catch {
      // Ignore unreadable worktree gitdir
    }
  }

  // Read standard main repo .git/config
  const mainRepo = findMainRepositoryRoot(repositoryRoot) ?? repositoryRoot;
  const configPath = join(mainRepo, ".git", "config");
  if (checkFileExists(configPath)) {
    try {
      const content = fileReader(configPath);
      const parsed = parseGitConfigLoads(content);
      if (parsed.length > 0) {
        return parsed;
      }
    } catch {
      // Ignore unreadable config
    }
  }

  return [];
}

export function resolveGitConfigPath(
  targetDirectory: string,
  checkFileExists: FileExistsFn = existsSync,
  fileReader: FileReaderFn = (filePath) => readFileSync(filePath, "utf-8"),
): string | undefined {
  const gitPath = join(targetDirectory, ".git");
  if (checkFileExists(gitPath)) {
    try {
      const stats = statSync(gitPath);
      if (stats.isFile()) {
        const content = fileReader(gitPath).trim();
        const match = content.match(/^gitdir:\s*(.+)$/m);
        if (match && match[1]) {
          const gitDir = resolve(targetDirectory, match[1].trim());
          const worktreeConfigPath = join(gitDir, "config.worktree");
          if (checkFileExists(worktreeConfigPath)) {
            return worktreeConfigPath;
          }
        }
      }
    } catch {
      // Ignore unreadable worktree gitdir
    }
  }

  const mainRepo = findMainRepositoryRoot(targetDirectory);
  if (mainRepo) {
    const configPath = join(mainRepo, ".git", "config");
    if (checkFileExists(configPath)) {
      return configPath;
    }
  }

  return undefined;
}

export function loadGitWorkspaceConfig(
  directory: string,
  options?: IWorkspaceResolverOptions,
): IWorkspaceConfig | undefined {
  const mainRepositoryRoot = findMainRepositoryRoot(directory);
  if (!mainRepositoryRoot) {
    return undefined;
  }

  const rawLoads = readGitConfigLoads(directory, options);
  if (rawLoads.length === 0) {
    return undefined;
  }

  const checkFileExists = options?.fileExists ?? existsSync;
  const fileReader = options?.fileReader ?? ((filePath) => readFileSync(filePath, "utf-8"));
  const homeDirectoryPath = options?.homeDirectoryPath;

  // Check if first entry points to a JSON configuration file
  const firstRaw = rawLoads[0];
  if (firstRaw) {
    const expandedFirst = expandHomeDirectory(firstRaw, homeDirectoryPath);
    const resolvedFirst = isAbsolute(expandedFirst) ? expandedFirst : resolve(mainRepositoryRoot, expandedFirst);

    if (firstRaw.endsWith(".json") || (checkFileExists(resolvedFirst) && resolvedFirst.endsWith(".json"))) {
      try {
        const fileContent = fileReader(resolvedFirst);
        const parsedJson = JSON.parse(fileContent);
        const parsedConfig = parseWorkspaceConfig(parsedJson);

        if (parsedConfig && parsedConfig.configs && parsedConfig.configs.length > 0) {
          const jsonDir = dirname(resolvedFirst);
          const normalizedRules: IWorkspaceRule[] = parsedConfig.configs.map((rule) => {
            const rawTargets = Array.isArray(rule.load) ? rule.load : [rule.load];
            const normalizedTargets = rawTargets.map((target) => {
              const exp = expandHomeDirectory(target, homeDirectoryPath);
              return isAbsolute(exp) ? exp : resolve(jsonDir, exp);
            });
            const ruleLoad: WorkspaceRuleLoad =
              normalizedTargets.length === 1 && normalizedTargets[0] !== undefined
                ? normalizedTargets[0]
                : normalizedTargets;
            return {
              when: rule.when,
              load: ruleLoad,
            };
          });

          return {
            configs: normalizedRules,
            gitConfigValue: resolvedFirst,
          };
        }
      } catch (error) {
        console.error(`[pi-workspace] Failed to parse JSON config from ${resolvedFirst}:`, error);
      }
    }
  }

  const resolvedPaths: string[] = [];
  for (const rawPath of rawLoads) {
    const expanded = expandHomeDirectory(rawPath, homeDirectoryPath);
    const resolvedPath = isAbsolute(expanded) ? expanded : resolve(mainRepositoryRoot, expanded);
    if (!resolvedPaths.includes(resolvedPath)) {
      resolvedPaths.push(resolvedPath);
    }
  }

  if (resolvedPaths.length === 0) {
    return undefined;
  }

  const ruleWhen = collapseHomeDirectory(mainRepositoryRoot, homeDirectoryPath);
  const ruleLoad: WorkspaceRuleLoad =
    resolvedPaths.length === 1 && resolvedPaths[0] !== undefined ? resolvedPaths[0] : resolvedPaths;

  return {
    configs: [
      {
        when: ruleWhen,
        load: ruleLoad,
      },
    ],
    gitConfigValue: rawLoads.length === 1 && rawLoads[0] !== undefined ? rawLoads[0] : rawLoads,
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
  const mainRepositoryRoot = findMainRepositoryRoot(currentWorkingDirectory);
  const matchedList: IWorkspaceMatchedConfig[] = [];

  for (const rule of rules) {
    const isDirectMatch = matchWorkspacePattern(rule.when, currentWorkingDirectory, options?.homeDirectoryPath);
    const isWorktreeMatch =
      !isDirectMatch && mainRepositoryRoot !== undefined
        ? matchWorkspacePattern(rule.when, mainRepositoryRoot, options?.homeDirectoryPath)
        : false;

    if (isDirectMatch || isWorktreeMatch) {
      const targetPaths = Array.isArray(rule.load) ? rule.load : [rule.load];

      for (const rawPath of targetPaths) {
        const expanded = expandHomeDirectory(rawPath, options?.homeDirectoryPath);
        const resolvedDirectory = resolve(expanded);

        if (checkFileExists(resolvedDirectory)) {
          const scan = scanDirectoryAssets(resolvedDirectory, checkFileExists, directoryReader);
          const alreadyMatched = matchedList.some((m) => m.load === resolvedDirectory && m.when === rule.when);
          if (!alreadyMatched) {
            matchedList.push({
              when: rule.when,
              load: resolvedDirectory,
              ...(scan.promptFileName !== undefined ? { promptFileName: scan.promptFileName } : {}),
              skillNames: scan.skillNames,
              promptNames: scan.promptNames,
              extensionFileNames: scan.extensionFileNames,
            });
          }
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
    if (!directories.includes(item.load)) {
      directories.push(item.load);
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
