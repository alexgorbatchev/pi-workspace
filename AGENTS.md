---
created_on: 2026-11-05 12:10
last_modified: 2026-11-05 12:27
status: current
---

# pi-workspace

Pi extension for ordered out-of-tree workspace layers, including instructions, skills, prompts, extensions, and settings.

## Commands

- `just setup`: install locked dependencies with Bun 1.4 or newer.
- `just run`: start Pi with the local extension and real user settings.
- `just check`: read-only formatting, lint, types, unused code, and coverage checks.
- `just test`: execute tests through the shared isolation supervisor.
- `just fmt`: format source, configuration, and the justfile.

## Runtime contracts

- Preserve the default export from `src/index.ts`; keep package exports and the Pi extension manifest aligned.
- Use the maintained `@earendil-works` SDK and explicit compatible peer ranges. Prefer native SDK types to duplicate local structures.
- Keep workspace assets outside the target repository. Resolve global, Git-local, and project configuration in their established order.
- Preserve canonical repository discovery for linked worktrees and Git configuration precedence over fallback file parsing.
- Preserve layer order, wildcard interpolation, asset deduplication, and verbatim instruction appending.
- Use native resource discovery for skills and prompts. Load workspace extension factories during initialization, and apply workspace settings on session start.
- Exclude workspace reports from model context and suppress reports in headless sessions.

## Tests and artifacts

- Update meaningful behavioral tests whenever executable behavior changes. Exercise the installed Pi loader and event runner with real owned filesystem fixtures.
- `just test` enforces at least 90% line and function coverage of non-test source through `bunfig.toml`. Include unexecuted source with the coverage preload; exclude tests, generated fixtures, and scripts. Reproduce blocking baseline failures on the untouched base and repair the smallest prerequisite without weakening gates.
- Consume the shared `@alexgorbatchev/pi-test-isolation` runner and preload from a pinned GitHub tag; never copy the implementation here.
- Keep Bun environment-file loading disabled. Direct `bun test` must fail outside a valid isolated environment.
- Create test directories with the shared test fixture helper. Register ownership cleanup immediately through `onTestFinished`, including fixtures created in setup hooks. Tests must remove their own files after success, failure, and timeout; supervisor cleanup is additional protection.
- Verify the full suite leaves an initially empty `TMPDIR` empty before supervisor cleanup. Keep child-process regressions for all three test outcomes.
- Compare checkout scratch, system temporary files, and processes before and after test changes. The isolation supervisor is not a filesystem sandbox.
- Use task-owned `.tmp/` children for disposable artifacts, `.state/` for retained records, and `.cache/` for regenerable caches. Never delete shared scratch by name.
- Manual demos use unique invocation-owned scratch and the maintained foreground-child wrapper to preserve interactive I/O, forward signals, and propagate child status. Route child toolchain temporary directories into owned scratch while preserving real user settings. Check every Git setup command; remove owned scratch only after the child exits. Preserve other invocations and existing scratch.
- Keep tests and tooling out of published packages; inspect the actual package contents before publication.

## Boundaries

- Record standing project instructions in the narrowest applicable guide and update existing rules in place. Never record task history, progress, or handoffs here.
- Commit the lockfile and keep CI on the verified Bun version.
- Publish required versions through the existing tag workflow after checks pass, with matching package and tag versions.
- Never publish credentials, private hostnames, or private tracker references.
