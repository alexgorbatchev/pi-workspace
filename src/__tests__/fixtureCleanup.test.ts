import { expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestDirectory } from "./fixtures/index.js";

test.each([
  ["success", "expect(true).toBe(true);", 0],
  ["failure", "expect(true).toBe(false);", 1],
  ["timeout", "await new Promise(() => {});", 1],
])("removes owned fixtures after %s without supervisor cleanup", async (_name, body, expectedCode) => {
  const scenario = createTestDirectory();
  const marker = join(scenario, "created-directory.txt");
  const fixtureModule = fileURLToPath(new URL("./fixtures/index.ts", import.meta.url));
  const guard = fileURLToPath(import.meta.resolve("@alexgorbatchev/pi-test-isolation/preload"));
  writeFileSync(join(scenario, "bunfig.toml"), `env = false\n[test]\npreload = [${JSON.stringify(guard)}]\n`);
  writeFileSync(
    join(scenario, "cleanup.test.ts"),
    `import { test, expect } from "bun:test";
import { writeFileSync } from "node:fs";
import { createTestDirectory } from ${JSON.stringify(fixtureModule)};
test("cleanup scenario", async () => {
  const directory = createTestDirectory();
  writeFileSync(${JSON.stringify(marker)}, directory);
  writeFileSync(directory + "/owned.txt", "fixture");
  ${body}
}, 50);
`,
  );
  const child = Bun.spawn([process.execPath, "--no-env-file", "test", "./cleanup.test.ts"], {
    cwd: scenario,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect({ code, missingFixture: !existsSync(readFileSync(marker, "utf8")) }, stdout + stderr).toEqual({
    code: expectedCode,
    missingFixture: true,
  });
});
