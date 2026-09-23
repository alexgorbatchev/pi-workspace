`@alexgorbatchev/pi-workspace` is an extension for the Pi Coding Agent that loads hierarchical organization-wide and project-specific skills, prompt templates, extensions, and system instructions from out-of-tree directories without modifying the target repository.

# What It Does

- **Out-of-tree configuration**: Keeps all project and organization assets completely outside the target repository, preserving a clean Git working tree.
- **Two-tier hierarchy**: Automatically discovers both organization-wide (`_common`) and project-specific resources for nested checkouts.
- **Layered system instructions**: Discovers and appends organizational standards and project rules to Pi's system prompt before each agent turn.
- **Native asset discovery**: Feeds external skill directories and prompt templates into Pi's resource loader as native `/skill:<name>` and `/<name>` commands.
- **Dynamic extension loading**: Evaluates and registers workspace-scoped TypeScript and JavaScript extensions at startup.
- **Workspace settings**: Applies organization and project defaults for models, thinking levels, and active tools.

# How It Works

1. Start Pi inside any repository under your development directory (for example, `~/development/example.com/auth-service`).
2. The extension inspects the working directory and matches it against your workspace root (by default, `~/.pi/agent/workspaces`).
3. It loads shared organization resources from `~/.pi/agent/workspaces/example.com/_common/` and project resources from `~/.pi/agent/workspaces/example.com/auth-service/`.
4. Organization instructions are layered above project instructions in the system prompt, while project skills and commands override organizational ones when names collide.
5. On startup, Pi displays the attributed workspace summary detailing the active organization, project, instruction files, and assets.

# How it Really Works

`@alexgorbatchev/pi-workspace` hooks into Pi's extension lifecycle to inject resources without requiring `.pi/` inside the target project:

- **Resolution precedence**: The workspace root resolves from `PI_WORKSPACES_ROOT`, then `@alexgorbatchev/pi-workspace.workspacesRoot` in `settings.json`, falling back to `~/.pi/agent/workspaces`. The base directory resolves from `PI_WORKSPACE_BASE_DIR`, then `baseDir`, falling back to `~/development`.
- **Directory mapping**: When the working directory sits under the base directory (e.g. `<baseDir>/<org>/<project>`), the extension identifies `<org>` and `<project>`. Explicit path mappings configured in `mappings` take priority over relative path calculation. If the working directory sits outside the base directory and has no explicit mapping, the project name falls back to the directory basename.
- **Organization common folder**: For organizational assets, the extension looks for `<workspacesRoot>/<org>/_common`, falling back to `common`, and then `<workspacesRoot>/<org>`.
- **Extension loading**: During extension initialization, the extension scans `extensions/` directories in the resolved organization and project folders. Supported scripts (`.ts` and `.js`, excluding declaration and test files) are imported dynamically and their default exported factory functions receive the `pi` `ExtensionAPI`.
- **Resource discovery**: On `resources_discover`, the extension returns existing `skills/` and `prompts/` subdirectories. Project paths are passed ahead of organization paths so project-level definitions take precedence when identifiers collide.
- **System prompt composition**: Before each turn (`before_agent_start`), the extension inspects organization and project folders for instruction files in order of precedence: `APPEND_SYSTEM.md`, `SYSTEM.md`, `AGENTS.md`, and `CLAUDE.md`. Discovered contents are appended with dedicated section headers to preserve prompt-cache stability.
- **Settings application**: On `session_start`, the extension parses `settings.json` in the organization and project directories. Configured `defaultTools`, `defaultThinkingLevel`, and `defaultModel` values are applied to the active session.

# Prerequisites

- Pi Coding Agent (`@earendil-works/pi-coding-agent >= 0.85.1`)
- Node.js `>= 22` (with TypeScript execution support) or Bun `>= 1.2`

# Installation

```bash
pi install npm:@alexgorbatchev/pi-workspace
```

To load directly without installing:

```bash
pi -e npm:@alexgorbatchev/pi-workspace
```

# Quick Start

Create an organization folder and project folder inside your workspaces root:

```bash
mkdir -p ~/.pi/agent/workspaces/example.com/_common/skills
mkdir -p ~/.pi/agent/workspaces/example.com/_common/prompts
mkdir -p ~/.pi/agent/workspaces/example.com/auth-service
```

Add organization-wide instructions and a project prompt:

```bash
echo "Follow corporate security policies." > ~/.pi/agent/workspaces/example.com/_common/APPEND_SYSTEM.md
echo "Run integration tests against localhost:8080." > ~/.pi/agent/workspaces/example.com/auth-service/APPEND_SYSTEM.md
```

Start Pi in your local checkout:

```bash
cd ~/development/example.com/auth-service
pi
```

Pi displays the attributed workspace summary:

```text
[@alexgorbatchev/pi-workspace]
  root: ~/.pi/agent/workspaces
  base: ~/development
  organization: example.com (~/.pi/agent/workspaces/example.com/_common)
    prompt: APPEND_SYSTEM.md
  project: auth-service (~/.pi/agent/workspaces/example.com/auth-service)
    prompt: APPEND_SYSTEM.md
```

# Configuration

Configure the extension in `~/.pi/agent/settings.json` under the `"@alexgorbatchev/pi-workspace"` key:

```json
{
  "@alexgorbatchev/pi-workspace": {
    "workspacesRoot": "~/.pi/agent/workspaces",
    "baseDir": "~/development",
    "mappings": {
      "/opt/repos/shared-monorepo": "example.com/monorepo"
    }
  }
}
```

| Option                  | Type   | Default                  | Description                                                               |
| :---------------------- | :----- | :----------------------- | :------------------------------------------------------------------------ |
| `workspacesRoot`        | string | `~/.pi/agent/workspaces` | Directory holding out-of-tree workspace configurations                    |
| `baseDir`               | string | `~/development`          | Base checkout directory used to infer `<org>/<project>` hierarchy         |
| `mappings`              | object | `{}`                     | Explicit mapping of repository paths to `<org>/<project>` workspace paths |
| `PI_WORKSPACES_ROOT`    | env    | none                     | Overrides the workspace root path                                         |
| `PI_WORKSPACE_BASE_DIR` | env    | none                     | Overrides the base checkout directory                                     |

# License

[MIT](LICENSE)
