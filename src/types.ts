import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type FileExistsFn = (filePath: string) => boolean;
export type FileReaderFn = (filePath: string) => string;
export type DirectoryReaderFn = (dirPath: string) => string[];

export interface IThemeFormatter {
  fg(color: string, text: string): string;
}

export interface IExtensionModule {
  readonly default?: (api: ExtensionAPI) => void | Promise<void>;
}

export type ExtensionImporterFn = (path: string) => Promise<IExtensionModule>;

export interface IModelMetadata {
  readonly provider: string;
  readonly id: string;
}

export interface IModelRegistryLookup {
  find(provider: string, id: string): unknown;
  getAll(): IModelMetadata[];
}

export interface ISettingsContext {
  readonly modelRegistry: IModelRegistryLookup;
}

export interface IWorkspaceConfig {
  readonly workspacesRoot?: string;
  readonly baseDir?: string;
  readonly mappings?: Record<string, string>;
}

export interface IWorkspaceDirectories {
  readonly orgDirectory?: string;
  readonly projectDirectory?: string;
  readonly orgName?: string;
  readonly projectName?: string;
}

export interface IWorkspaceResourcePaths {
  readonly skillPaths: string[];
  readonly promptPaths: string[];
  readonly extensionPaths: string[];
}

export interface IWorkspaceSettings {
  readonly defaultTools?: string[];
  readonly defaultThinkingLevel?: string;
  readonly defaultModel?: string;
}

export type WorkspaceTierType = "organization" | "project";

export interface IWorkspaceTierAssets {
  readonly name: string;
  readonly directoryPath: string;
  readonly promptFileName?: string | undefined;
  readonly skillNames: string[];
  readonly promptNames: string[];
  readonly extensionFileNames: string[];
}

export interface IWorkspaceReportDetails {
  readonly workspacesRoot: string;
  readonly baseDir: string;
  readonly org?: IWorkspaceTierAssets | undefined;
  readonly project?: IWorkspaceTierAssets | undefined;
}
