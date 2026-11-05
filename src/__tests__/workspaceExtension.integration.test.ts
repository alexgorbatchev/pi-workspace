import { fauxProvider } from "@earendil-works/pi-ai";
import {
  DefaultResourceLoader,
  ExtensionRunner,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
  getAgentDir,
  initTheme,
  keyHint,
  keyText,
} from "@earendil-works/pi-coding-agent";
import type {
  ExtensionActions,
  ExtensionError,
  ExtensionRuntime,
  MessageRenderer,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, expect, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { workspaceExtension } from "../workspaceExtension.js";
import { CONFIG_KEY } from "../workspaceResolver.js";
import { createTestDirectory } from "./fixtures/index.js";

type ModelSelectionCase = [string, string[]];

type ReportRenderCase = [Parameters<MessageRenderer>[0]["content"], string];

let project: string;
let layer: string;
let runner: ExtensionRunner;
let modelRuntime: ModelRuntime;
let reports: Parameters<ExtensionActions["sendMessage"]>[0][];
let errors: ExtensionError[];
let tools: string[][];
let thinking: Parameters<ExtensionRuntime["setThinkingLevel"]>[0][];
let models: Parameters<ExtensionRuntime["setModel"]>[0][];

beforeEach(async () => {
  project = createTestDirectory();
  layer = join(project, "layer");
  mkdirSync(join(project, ".pi"));
  mkdirSync(join(project, ".git"));
  mkdirSync(layer);
  initTheme("dark", false);
  reports = [];
  errors = [];
  tools = [];
  thinking = [];
  models = [];
  modelRuntime = await ModelRuntime.create({ refreshOnCreate: false, allowModelNetwork: false, modelsPath: null });
});

afterEach(async () => {
  modelRuntime.unregisterProvider("workspace-test");
  await modelRuntime.refresh({ allowNetwork: false });
  expect(errors).toEqual([]);
});

function configureLayer(): void {
  writeFileSync(
    join(project, ".pi/settings.json"),
    JSON.stringify({ [CONFIG_KEY]: { configs: [{ when: project, load: layer }] } }),
  );
}

async function startRunner(): Promise<void> {
  const loader = new DefaultResourceLoader({
    cwd: project,
    agentDir: getAgentDir(),
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    extensionFactories: [workspaceExtension],
  });
  const previousCwd = process.cwd();
  try {
    process.chdir(project);
    await loader.reload();
  } finally {
    process.chdir(previousCwd);
  }
  const result = loader.getExtensions();
  expect(result.errors).toEqual([]);
  result.runtime.sendMessage = (message) => {
    reports.push(message);
  };
  result.runtime.setActiveTools = (names) => {
    tools.push(names);
  };
  result.runtime.setThinkingLevel = (level) => {
    thinking.push(level);
  };
  result.runtime.setModel = async (model) => {
    models.push(model);
    return true;
  };
  runner = new ExtensionRunner(
    result.extensions,
    result.runtime,
    project,
    SessionManager.inMemory(project),
    new ModelRegistry(modelRuntime),
  );
  runner.bindCore(result.runtime, {
    getModel: () => undefined,
    getScopedModels: () => [],
    isIdle: () => true,
    isProjectTrusted: () => true,
    getSignal: () => undefined,
    abort: () => assert.fail("Unexpected abort"),
    hasPendingMessages: () => false,
    shutdown: () => assert.fail("Unexpected shutdown"),
    getContextUsage: () => undefined,
    compact: () => assert.fail("Unexpected compaction"),
    getSystemPrompt: () => "",
  });
  runner.setUIContext({ ...runner.getUIContext() });
  runner.onError((error) => {
    errors.push(error);
  });
}

test("loads workspace extensions, discovers assets, appends instructions, and applies settings", async () => {
  configureLayer();
  mkdirSync(join(layer, "skills/review"), { recursive: true });
  mkdirSync(join(layer, "prompts"));
  mkdirSync(join(layer, "extensions"));
  writeFileSync(
    join(layer, "skills/review/SKILL.md"),
    "---\nname: review\ndescription: Review changes.\n---\nReview the changes.\n",
  );
  writeFileSync(join(layer, "prompts/review.md"), "Review the changes.");
  writeFileSync(join(layer, "APPEND_SYSTEM.md"), "  Workspace instructions.\n");
  writeFileSync(
    join(layer, "extensions/command.ts"),
    'export default function (pi) { pi.registerCommand("workspace-command", {description: "Workspace command", handler: async () => {}}); }',
  );
  writeFileSync(
    join(layer, "settings.json"),
    JSON.stringify({ defaultTools: ["read"], defaultThinkingLevel: "high", defaultModel: "workspace-test/balanced" }),
  );
  const provider = fauxProvider({ provider: "workspace-test", models: [{ id: "balanced" }] });
  modelRuntime.registerNativeProvider(provider.provider);
  await modelRuntime.refresh({ allowNetwork: false });
  await startRunner();
  expect(runner.getCommand("workspace-command")?.description).toBe("Workspace command");
  const resources = await runner.emitResourcesDiscover(project, "startup");
  expect(resources.skillPaths.map((item) => item.path)).toEqual([join(layer, "skills")]);
  expect(resources.promptPaths.map((item) => item.path)).toEqual([join(layer, "prompts")]);
  const before = await runner.emitBeforeAgentStart(
    { messageType: "user", prompt: "Work" },
    { cwd: project, forceSystemPrompt: "Base instructions." },
  );
  expect(before.systemPromptOptions.forceSystemPrompt).toBe("Base instructions.\n\nWorkspace instructions.");
  await runner.emit({ type: "session_start", reason: "startup" });
  expect(tools).toEqual([["read"]]);
  expect(thinking).toEqual(["high"]);
  expect(models.map((model) => [model.provider, model.id])).toEqual([["workspace-test", "balanced"]]);
  expect(reports.map((report) => Bun.stripANSI(String(report.content)).replaceAll(project, "<project>"))).toEqual([
    "[@alexgorbatchev/pi-workspace]\n  cwd: <project>\n  config:\n    when: <project>\n    load: <project>/layer\n    prompt: APPEND_SYSTEM.md\n    skills:\n      - review\n    commands:\n      - review\n    extensions:\n      - command.ts",
  ]);
});

test("keeps empty and headless sessions quiet and leaves the system prompt intact", async () => {
  await startRunner();
  runner.setUIContext();
  await runner.emit({ type: "session_start", reason: "startup" });
  const before = await runner.emitBeforeAgentStart(
    { messageType: "user", prompt: "Work" },
    { cwd: project, forceSystemPrompt: "Base" },
  );
  expect(before.systemPromptOptions.forceSystemPrompt).toBe("Base");
  expect(reports).toEqual([]);
  expect(tools).toEqual([]);
  expect(await runner.emitResourcesDiscover(project, "startup")).toEqual({
    skillPaths: [],
    promptPaths: [],
    themePaths: [],
  });
});

test.each<ModelSelectionCase>([
  ["balanced", ["balanced"]],
  ["BALANCED", ["balanced"]],
  ["unknown/model", []],
])("selects model by identifier or ignores unknown model: %s", async (name, expected) => {
  configureLayer();
  writeFileSync(join(layer, "settings.json"), JSON.stringify({ defaultModel: name, defaultThinkingLevel: "invalid" }));
  const provider = fauxProvider({ provider: "workspace-test", models: [{ id: "balanced" }] });
  modelRuntime.registerNativeProvider(provider.provider);
  await modelRuntime.refresh({ allowNetwork: false });
  await startRunner();
  await runner.emit({ type: "session_start", reason: "startup" });
  expect(models.map((model) => model.id)).toEqual(expected);
  expect(thinking).toEqual([]);
});

test("removes only workspace reports from model context", async () => {
  await startRunner();
  const user = { role: "user", content: "Work", timestamp: 1 } as const;
  const other = { role: "custom", customType: "other", content: "Other", display: true, timestamp: 2 } as const;
  expect(
    await runner.emitContext([
      user,
      other,
      { role: "custom", customType: CONFIG_KEY, content: "Report", display: true, timestamp: 3 },
    ]),
  ).toEqual([user, other]);
});

test.each<ReportRenderCase>([
  ["Report", "Report"],
  [
    [
      { type: "text", text: "First" },
      { type: "image", data: "AA==", mimeType: "image/png" },
      { type: "text", text: "Second" },
    ],
    "First\nSecond",
  ],
])("renders plain or mixed workspace reports", async (content, expected) => {
  await startRunner();
  const renderer = runner.getMessageRenderer(CONFIG_KEY);
  assert(renderer);
  const component = renderer(
    { role: "custom", customType: CONFIG_KEY, content, display: true, timestamp: 1 },
    { expanded: false, outputPad: 0, keyHint, keyText },
    runner.getUIContext().theme,
  );
  assert(component);
  expect(
    component
      .render(120)
      .map((line) => Bun.stripANSI(line).trimEnd())
      .join("\n"),
  ).toBe(expected);
});
