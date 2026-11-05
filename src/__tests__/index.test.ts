import { DefaultResourceLoader, getAgentDir } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const extensionPath = fileURLToPath(new URL("../index.ts", import.meta.url));

describe("pi-workspace extension entry", () => {
  let projectDir = "";

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  test("loads through Pi's extension loader and registers its event handlers and message renderer", async () => {
    projectDir = mkdtempSync(path.join(tmpdir(), "pi-workspace-project-"));
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
