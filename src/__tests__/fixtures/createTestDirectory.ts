import { onTestFinished } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function createTestDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "pi-workspace-test-"));
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
