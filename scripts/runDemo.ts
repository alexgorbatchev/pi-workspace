import { foregroundChild } from "foreground-child";
import type { Cleanup } from "foreground-child";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

export interface IDemoCommand {
  readonly command: string;
  readonly args: string[];
  readonly cwd: string;
}

export interface IDemoPlan extends IDemoCommand {
  readonly setup?: readonly IDemoCommand[];
}

export type PrepareDemoFn = (directory: string) => IDemoPlan;

function startCommand(command: IDemoCommand, env: NodeJS.ProcessEnv, cleanup: Cleanup): void {
  const child = foregroundChild(command.command, command.args, { cwd: command.cwd, env }, cleanup);
  child.on("error", (error) => {
    console.error(`Failed to start demo command: ${error.message}`);
  });
}

export async function runDemo(repository: string, prepare: PrepareDemoFn): Promise<void> {
  const scratch = join(repository, ".tmp");
  mkdirSync(scratch, { recursive: true });
  const directory = mkdtempSync(join(scratch, "pi-demo-"));
  const cleanup = (): void => rmSync(directory, { recursive: true, force: true });
  try {
    const temporary = join(directory, "tmp");
    mkdirSync(temporary);
    const env = { ...process.env, TMPDIR: temporary, TMP: temporary, TEMP: temporary };
    const plan = prepare(directory);
    for (const command of plan.setup ?? []) {
      await new Promise<void>((resolve) => {
        startCommand(command, env, (code, signal) => {
          if (code === 0 && signal === null) {
            resolve();
            return false;
          }
          cleanup();
          return signal ?? code ?? 1;
        });
      });
    }
    startCommand(plan, env, cleanup);
  } catch (error) {
    cleanup();
    throw error;
  }
}
