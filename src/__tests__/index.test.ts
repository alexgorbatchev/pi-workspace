import { createTestDirectory } from "./fixtures/index.js";
import { DefaultResourceLoader, getAgentDir } from "@earendil-works/pi-coding-agent";
import { onTestFinished, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const extensionPath = fileURLToPath(new URL("../index.ts", import.meta.url));

describe("pi-workspace extension entry", () => {
  test("loads through Pi's extension loader and registers its event handlers and message renderer", async () => {
    const projectDir = createTestDirectory();
    const originalEnvironment = { TMPDIR: process.env.TMPDIR, TMP: process.env.TMP, TEMP: process.env.TEMP };
    onTestFinished(() => {
      Object.assign(process.env, originalEnvironment);
    });
    const loaderTemporaryDirectory = join(projectDir, "loader-tmp");
    mkdirSync(loaderTemporaryDirectory);
    Object.assign(process.env, {
      TMPDIR: loaderTemporaryDirectory,
      TMP: loaderTemporaryDirectory,
      TEMP: loaderTemporaryDirectory,
    });
    const loader = new DefaultResourceLoader({
      cwd: projectDir,
      agentDir: getAgentDir(),
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      additionalExtensionPaths: [extensionPath],
    });

    await loader.reload();
    const { extensions, errors } = loader.getExtensions();

    expect(errors).toEqual([]);
    expect(
      extensions.map((extension) => [
        extension.path,
        [...extension.handlers.keys()],
        [...extension.messageRenderers.keys()],
      ]),
    ).toEqual([
      [
        extensionPath,
        ["context", "resources_discover", "before_agent_start", "session_start"],
        ["@alexgorbatchev/pi-workspace"],
      ],
    ]);
  });
});
