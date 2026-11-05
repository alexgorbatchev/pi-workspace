import { expect, onTestFinished, test } from "bun:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestDirectory } from "../../src/__tests__/fixtures/index.js";

const runner = fileURLToPath(new URL("../runDemo.ts", import.meta.url));

test("cleans owned scratch when preparing demo files fails", async () => {
  const root = createTestDirectory();
  const script = join(root, "run.ts");
  await Bun.write(
    script,
    `import {runDemo} from ${JSON.stringify(runner)};
import {mkdirSync} from "node:fs";
await runDemo(${JSON.stringify(root)}, directory => {
 mkdirSync(directory);
 return {command: process.execPath, args: ["-e", "process.exit(0)"], cwd: directory};
});`,
  );
  const child = Bun.spawn([process.execPath, script], { env: process.env, stdout: "pipe", stderr: "pipe" });
  onTestFinished(async () => {
    child.kill();
    await child.exited;
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, stdout + stderr).toBe(1);
  expect(readdirSync(join(root, ".tmp"))).toEqual([]);
});

test("routes native toolchain temporary files into owned scratch while preserving user settings", async () => {
  const root = createTestDirectory();
  const script = join(root, "run.ts");
  await Bun.write(
    script,
    `import {runDemo} from ${JSON.stringify(runner)};
await runDemo(${JSON.stringify(root)}, directory => ({
 command: process.execPath,
 args: ["-e", 'import {tmpdir} from "node:os"; import {join} from "node:path"; await Bun.write(join(tmpdir(), "loader-cache"), "cache"); console.log(JSON.stringify({temporary: tmpdir(), home: process.env.HOME, agent: process.env.PI_CODING_AGENT_DIR, cwd: process.cwd()}));'],
 cwd: directory,
}));`,
  );
  const child = Bun.spawn([process.execPath, script], { env: process.env, stdout: "pipe", stderr: "pipe" });
  onTestFinished(async () => {
    child.kill();
    await child.exited;
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, stdout + stderr).toBe(0);
  const result = JSON.parse(stdout);
  expect(result).toEqual({
    temporary: join(result.cwd, "tmp"),
    home: process.env.HOME,
    agent: process.env.PI_CODING_AGENT_DIR,
    cwd: result.cwd,
  });
  expect(existsSync(result.temporary)).toBe(false);
  expect(readdirSync(join(root, ".tmp"))).toEqual([]);
});

type DemoExitCase = [string, string, string, number];

test.each<DemoExitCase>([
  ["success", "process.execPath", 'args: ["-e", "process.exit(0)"]', 0],
  ["failure", "process.execPath", 'args: ["-e", "process.exit(7)"]', 7],
  ["missing executable", 'directory + "/missing"', "args: []", 254],
])("removes only invocation-owned scratch after %s", async (_name, command, args, expectedCode) => {
  const root = createTestDirectory();
  mkdirSync(join(root, ".tmp/shared"), { recursive: true });
  writeFileSync(join(root, ".tmp/shared/keep"), "Existing scratch.");
  const marker = join(root, "directory.txt");
  const script = join(root, "run.ts");
  writeFileSync(
    script,
    `import {runDemo} from ${JSON.stringify(runner)};
import {writeFileSync} from "node:fs";
await runDemo(${JSON.stringify(root)}, directory => {
 writeFileSync(${JSON.stringify(marker)}, directory);
 return {command: ${command}, ${args}, cwd: directory};
});`,
  );
  const child = Bun.spawn([process.execPath, script], { env: process.env, stdout: "pipe", stderr: "pipe" });
  onTestFinished(async () => {
    child.kill();
    await child.exited;
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, stdout + stderr).toBe(expectedCode);
  expect(existsSync(readFileSync(marker, "utf8"))).toBe(false);
  expect(readdirSync(join(root, ".tmp"))).toEqual(["shared"]);
  expect(readFileSync(join(root, ".tmp/shared/keep"), "utf8")).toBe("Existing scratch.");
});

test("cleans owned scratch when native setup fails before launching Pi", async () => {
  const root = createTestDirectory();
  const script = join(root, "run.ts");
  writeFileSync(
    script,
    `import {runDemo} from ${JSON.stringify(runner)};
await runDemo(${JSON.stringify(root)}, directory => {
 return {
  setup: [{command: process.execPath, args: ["-e", "process.exit(8)"], cwd: directory}],
  command: process.execPath, args: ["-e", "process.exit(0)"], cwd: directory
 };
});`,
  );
  const child = Bun.spawn([process.execPath, script], { env: process.env, stdout: "pipe", stderr: "pipe" });
  onTestFinished(async () => {
    child.kill();
    await child.exited;
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, stdout + stderr).toBe(8);
  expect(readdirSync(join(root, ".tmp"))).toEqual([]);
});

test.each<NodeJS.Signals>(["SIGINT", "SIGTERM", "SIGHUP"])(
  "forwards %s and preserves concurrent demo scratch until each child exits",
  async (signal) => {
    const root = createTestDirectory();
    const script = join(root, "run.ts");
    writeFileSync(
      script,
      `import {runDemo} from ${JSON.stringify(runner)};
await runDemo(${JSON.stringify(root)}, directory => ({
 command: process.execPath,
 args: ["-e", 'console.log(process.cwd()); setInterval(() => {}, 1000);'],
 cwd: directory,
}));`,
    );
    const first = spawn(process.execPath, [script], { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    const firstClosed = once(first, "close");
    onTestFinished(async () => {
      first.kill("SIGTERM");
      await firstClosed;
    });
    const second = spawn(process.execPath, [script], { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    const secondClosed = once(second, "close");
    onTestFinished(async () => {
      second.kill("SIGTERM");
      await secondClosed;
    });
    const [[firstOutput], [secondOutput]] = await Promise.all([
      once(first.stdout, "data"),
      once(second.stdout, "data"),
    ]);
    const firstDirectory = String(firstOutput).trim();
    const secondDirectory = String(secondOutput).trim();
    expect(firstDirectory).not.toBe(secondDirectory);
    expect(readdirSync(join(root, ".tmp"))).toHaveLength(2);
    first.kill(signal);
    expect(await firstClosed).toEqual([null, signal]);
    expect(existsSync(firstDirectory)).toBe(false);
    expect(existsSync(secondDirectory)).toBe(true);
    second.kill(signal);
    expect(await secondClosed).toEqual([null, signal]);
    expect(readdirSync(join(root, ".tmp"))).toEqual([]);
  },
);

type DemoEntryCase = [string, string[]];

test.each<DemoEntryCase>([
  ["test-local.ts", []],
  ["test-local.ts", ["portal"]],
  ["test-local.ts", ["worktree"]],
  ["test-worktree.ts", ["main"]],
])("runs the actual %s demo entry %j with Pi help and cleans its scratch", async (entry, args) => {
  const repository = fileURLToPath(new URL("../../", import.meta.url));
  const scratch = join(repository, ".tmp");
  const before = readdirSync(scratch).sort();
  const child = Bun.spawn([process.execPath, join(repository, "scripts", entry), ...args, "--help"], {
    cwd: repository,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  onTestFinished(async () => {
    child.kill();
    await child.exited;
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, stdout + stderr).toBe(0);
  expect(readdirSync(scratch).sort()).toEqual(before);
});

test("cleans invocation scratch when cancelled during setup", async () => {
  const root = createTestDirectory();
  const script = join(root, "run.ts");
  writeFileSync(
    script,
    `import {runDemo} from ${JSON.stringify(runner)};
await runDemo(${JSON.stringify(root)}, directory => {
 return {
  setup: [{command: process.execPath, args: ["-e", 'console.log(process.cwd()); setInterval(() => {}, 1000);'], cwd: directory}],
  command: process.execPath, args: ["-e", "process.exit(0)"], cwd: directory
 };
});`,
  );
  const child = spawn(process.execPath, [script], { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  const closed = once(child, "close");
  onTestFinished(async () => {
    child.kill("SIGTERM");
    await closed;
  });
  const [output] = await once(child.stdout, "data");
  expect(existsSync(String(output).trim())).toBe(true);
  child.kill("SIGTERM");
  expect(await closed).toEqual([null, "SIGTERM"]);
  expect(readdirSync(join(root, ".tmp"))).toEqual([]);
});
