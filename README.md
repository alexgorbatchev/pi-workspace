`@alexgorbatchev/pi-workspace` is an extension for the Pi Coding Agent that maps repository paths to ordered lists of out-of-tree workspace folders, loading their skills, prompt templates, extensions, settings, and system instructions without modifying the target repository.

# What It Does

- **Out-of-tree configuration**: Keeps all project and organization assets completely outside the target repository, preserving a clean Git working tree.
- **Declarative pattern mapping**: Maps repository checkouts to layered workspace directories using exact paths or single-star (`*`) wildcards.
- **Ordered layer resolution**: Loads and cascades shared organizational layers and repository-specific layers in the exact sequence configured.
- **Verbatim system instructions**: Reads and appends `APPEND_SYSTEM.md`, `SYSTEM.md`, `AGENTS.md`, or `CLAUDE.md` files as written, without synthetic headers.
- **Native asset discovery**: Feeds external `skills/` and `prompts/` subdirectories into Pi's resource loader as native `/skill:<name>` and `/<name>` commands.
- **Dynamic extension loading**: Evaluates and registers workspace-scoped TypeScript and JavaScript extensions at startup.
- **Workspace settings**: Applies layer-defined defaults for models, thinking levels, and active tools.

# How It Works

1. Define your path mappings in `~/.pi/agent/settings.json` under `@alexgorbatchev/pi-workspace.workspaces`.
2. Start Pi inside any repository matching a configured pattern (for example, `~/development/company-a/auth-service`).
3. The extension matches the pattern, extracts any wildcard captures, and resolves the target workspace directories in order.
4. It loads shared layer resources (e.g. `~/.pi/workspaces/company-a/_common`) followed by project-specific resources (e.g. `~/.pi/workspaces/company-a/auth-service`).
5. On startup, Pi displays the attributed workspace summary detailing the active workspaces, instruction files, and assets.

# How it Really Works

`@alexgorbatchev/pi-workspace` hooks into Pi's extension lifecycle to inject resources without requiring `.pi/` inside the target repository:

- **Pattern resolution**: When Pi starts or switches directories, the extension compares the current working directory against configured workspace patterns. Exact patterns take precedence over wildcard patterns.
- **Capture interpolation**: Single-segment wildcards (`*`) and named parameters (`:name`) capture path segments from the current working directory. Targets reference them via `:1`, `:2` (or `$1`, `$2`) and `:name`.
- **Layer ordering**: Target directories are evaluated in the order listed in the mapping array. Layer instructions are appended in that exact sequence, and project-level skills and prompt templates override earlier layers when names collide.
- **Verbatim instruction injection**: Before each agent turn (`before_agent_start`), the extension checks each resolved directory for `APPEND_SYSTEM.md`, `SYSTEM.md`, `AGENTS.md`, or `CLAUDE.md`. The contents are appended directly to Pi's system prompt without synthetic section headers.
- **Resource discovery**: On `resources_discover`, existing `skills/` and `prompts/` subdirectories from all matched layers are registered with Pi's resource loader. Command names drop any leading slashes and are sorted alphabetically.
- **Extension loading**: During extension initialization, the extension scans `extensions/` subdirectories in all resolved layers. Supported scripts (`.ts` and `.js`, excluding declaration and test files) are dynamically imported and their default exported factory functions receive the `pi` `ExtensionAPI`.
- **Settings application**: On `session_start`, the extension parses `settings.json` across matched layers in order. Configured `defaultTools`, `defaultThinkingLevel`, and `defaultModel` values are applied to the active session.

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

Create an organization folder and project folder inside your workspace storage:

```bash
mkdir -p ~/.pi/workspaces/company-a/_common/prompts
mkdir -p ~/.pi/workspaces/company-a/auth-service
```

Add shared and project-specific instructions:

```bash
echo "Follow corporate security policies." > ~/.pi/workspaces/company-a/_common/APPEND_SYSTEM.md
echo "Run integration tests before pushing." > ~/.pi/workspaces/company-a/auth-service/APPEND_SYSTEM.md
```

Configure the mapping in `~/.pi/agent/settings.json`:

```json
{
  "@alexgorbatchev/pi-workspace": {
    "workspaces": {
      "~/development/company-a/*": ["~/.pi/workspaces/company-a/_common", "~/.pi/workspaces/company-a/:1"]
    }
  }
}
```

Start Pi in your local checkout:

```bash
cd ~/development/company-a/auth-service
pi
```

Pi displays the attributed workspace summary:

```text
[@alexgorbatchev/pi-workspace]
  workspace: ~/.pi/workspaces/company-a/_common
    prompt: APPEND_SYSTEM.md
  workspace: ~/.pi/workspaces/company-a/auth-service
    prompt: APPEND_SYSTEM.md
```

# Configuration

Configure the extension in `~/.pi/agent/settings.json` under the `"@alexgorbatchev/pi-workspace"` key:

```json
{
  "@alexgorbatchev/pi-workspace": {
    "workspaces": {
      "~/development/company-a/*": ["~/.pi/workspaces/company-a/_common", "~/.pi/workspaces/company-a/:1"],
      "~/development/company-b/client-portal": ["~/.pi/workspaces/company-b/portal"]
    }
  }
}
```

| Option       | Type   | Default | Description                                                             |
| :----------- | :----- | :------ | :---------------------------------------------------------------------- |
| `workspaces` | object | `{}`    | Map of checkout path patterns to ordered lists of workspace directories |

Each key is a path pattern supporting `~` expansion and `*` or `:name` wildcards. Each value is an array of directory paths (or single string path) supporting `:1`, `:2` (or `$1`, `$2`) and `:name` replacements.

# License

[MIT](LICENSE)
