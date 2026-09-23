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

export type WorkspaceTargetDefinition = string[] | string;
export type WorkspaceMappings = Record<string, WorkspaceTargetDefinition>;

export interface IWorkspaceConfig {
  readonly workspaces?: WorkspaceMappings | undefined;
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

export interface IWorkspaceDirectoryAssets {
  readonly directoryPath: string;
  readonly promptFileName?: string | undefined;
  readonly skillNames: string[];
  readonly promptNames: string[];
  readonly extensionFileNames: string[];
}

export interface IWorkspaceReportDetails {
  readonly workspaces: IWorkspaceDirectoryAssets[];
}
