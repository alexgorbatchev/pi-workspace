`@alexgorbatchev/pi-workspace` is an extension for the Pi Coding Agent that maps repository paths to ordered lists of out-of-tree workspace folders, loading their skills, prompt templates, extensions, settings, and system instructions without modifying the target repository.

By default, configuring project-specific instructions, skills, and extensions in Pi requires adding a `.pi/` folder to the target repository or maintaining individual project paths in Pi's global `settings.json`. This creates friction when working on client codebases, open-source projects, or team repositories where committing agent-specific artifacts is prohibited, or when managing dozens of microservices that need to share organizational standards without duplicating configuration across every repository and Git worktree. `@alexgorbatchev/pi-workspace` solves this by keeping all workspace assets completely out-of-tree, allowing repositories and worktrees to autodiscover their layered instructions, prompts, skills, and extensions while preserving a clean Git working tree.

# What It Does

- **Out-of-tree configuration**: Keeps all project and organization assets completely outside the target repository, preserving a clean Git working tree.
- **Git-native local configuration**: Assigns workspaces to repositories via `git config --local pi-workspace.config <path-to-.json>` or `pi-workspace.load <paths>`, leaving the working tree completely clean and global Pi settings untouched.
- **Declarative pattern mapping**: Maps repository checkouts to layered workspace directories using exact paths or single-star (`*`) wildcards.
- **Ordered layer resolution**: Loads and cascades shared organizational layers and repository-specific layers in the exact sequence configured.
- **Git worktree support**: Automatically resolves the main repository root when running inside `.worktrees/<name>`, `.workspaces/<name>`, or detached worktrees.
- **Verbatim system instructions**: Reads and appends `APPEND_SYSTEM.md`, `SYSTEM.md`, `AGENTS.md`, or `CLAUDE.md` files as written, without synthetic headers.
- **Native asset discovery**: Feeds external `skills/` and `prompts/` subdirectories into Pi's resource loader as native `/skill:<name>` and `/<name>` commands.
- **Dynamic extension loading**: Evaluates and registers workspace-scoped TypeScript and JavaScript extensions at startup.
- **Workspace settings**: Applies layer-defined defaults for models, thinking levels, and active tools.

# How It Works

1. Configure workspace paths either in your repository via Git configuration (`git config --local pi-workspace.config <path>` or `pi-workspace.load <paths>`) or in `~/.pi/agent/settings.json` under `"@alexgorbatchev/pi-workspace"`.
2. Start Pi inside any repository matching a configured pattern or Git setting (for example, `~/development/company-a/auth-service`).
3. The extension matches the pattern and resolves the target workspace directories in order.
4. It loads shared layer resources (e.g. `~/.pi/workspaces/company-a/_common`) followed by project-specific resources (e.g. `~/.pi/workspaces/company-a/auth-service`).
5. On startup, Pi displays the attributed workspace summary detailing the active workspaces, instruction files, and assets.

# How it Really Works

`@alexgorbatchev/pi-workspace` hooks into Pi's extension lifecycle to inject resources without requiring `.pi/` inside the target repository:

- **Git configuration autodiscovery**: Before matching path rules, the extension reads `pi-workspace.config` (JSON configuration file) or `pi-workspace.load` (workspace directory paths) from the repository's Git configuration (`.git/config` or linked worktree configs). Relative paths resolve against the canonical repository root, allowing clean project-level configuration without committing files or touching global settings.
- **Pattern resolution**: When Pi starts or switches directories, the extension compares the current working directory against configured workspace patterns.
- **Worktree detection**: When running inside a Git worktree (such as `<repo>/.worktrees/<name>`, `<repo>/.workspaces/<name>`, or a detached worktree directory), the extension resolves the worktree's `.git` file and `commondir` back to the canonical main repository root. Rules configured for the repository automatically apply in worktrees.
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

### Option A: Configure in Git (Zero Global Settings, Clean Repo)

Set the workspace path directly inside your local checkout's `.git/config`:

```bash
cd ~/development/company-a/auth-service
git config --local --add pi-workspace.load ~/.pi/workspaces/company-a/_common
git config --local --add pi-workspace.load ~/.pi/workspaces/company-a/auth-service
```

### Option B: Configure in Pi Settings

Alternatively, configure the mapping in `~/.pi/agent/settings.json`:

```json
{
  "@alexgorbatchev/pi-workspace": {
    "configs": [
      {
        "when": "~/development/company-a/*",
        "load": "~/.pi/workspaces/company-a/_common"
      },
      {
        "when": "~/development/company-a/auth-service",
        "load": "~/.pi/workspaces/company-a/auth-service"
      }
    ]
  }
}
```

Start Pi in your local checkout:

```bash
cd ~/development/company-a/auth-service
pi
```

Pi displays the attributed workspace summary (showing configured `git:` values when using Option A):

```text
[@alexgorbatchev/pi-workspace]
  git:
    - ~/.pi/workspaces/company-a/_common
    - ~/.pi/workspaces/company-a/auth-service
  cwd: ~/development/company-a/auth-service
  config:
    when: ~/development/company-a/auth-service
    load: ~/.pi/workspaces/company-a/_common
    prompt: APPEND_SYSTEM.md
  config:
    when: ~/development/company-a/auth-service
    load: ~/.pi/workspaces/company-a/auth-service
    prompt: APPEND_SYSTEM.md
```

# Configuration

### Git Local Configuration (Recommended)

Configure workspace paths on any repository using `git config`:

```bash
# Option 1: Point to a JSON configuration file
git config --local pi-workspace.config ~/.pi/workspaces/company-a/auth-service.json

# Option 2: Add a single workspace path directly
git config --local pi-workspace.load ~/.pi/workspaces/company-a/auth-service

# Option 3: Add multiple layers (evaluated in order)
git config --local --add pi-workspace.load ~/.pi/workspaces/company-a/_common
git config --local --add pi-workspace.load ~/.pi/workspaces/company-a/auth-service

# Or use comma-separated paths
git config --local pi-workspace.load "~/.pi/workspaces/company-a/_common, ~/.pi/workspaces/company-a/auth-service"
```

| Git Key               | Scope | Description                                                                                   |
| :-------------------- | :---- | :-------------------------------------------------------------------------------------------- |
| `pi-workspace.config` | local | Path to a `.json` file defining workspace rules. Worktrees automatically inherit it.          |
| `pi-workspace.load`   | local | Out-of-tree workspace directory path (or multiple paths). Worktrees automatically inherit it. |

### Global Settings Configuration

Alternatively, configure the extension in `~/.pi/agent/settings.json` under the `"@alexgorbatchev/pi-workspace"` key:

```json
{
  "@alexgorbatchev/pi-workspace": {
    "configs": [
      {
        "when": "~/development/company-a/*",
        "load": "~/.pi/workspaces/company-a/_common"
      },
      {
        "when": "~/development/company-a/auth-service",
        "load": "~/.pi/workspaces/company-a/auth-service"
      },
      {
        "when": "~/development/company-b/client-portal",
        "load": "~/.pi/workspaces/company-b/portal"
      }
    ]
  }
}
```

| Option    | Type  | Default | Description                                                                           |
| :-------- | :---- | :------ | :------------------------------------------------------------------------------------ |
| `configs` | array | `[]`    | Ordered list of `{ when, load }` rules pairing checkout patterns with asset locations |

Each rule defines:

- `when`: Checkout directory path or pattern supporting `~` expansion and `*` wildcards.
- `load`: Absolute or `~`-prefixed path (or array of paths) pointing to where the workspace assets live on disk.

All rules matching the current working directory apply in order. Earlier rules provide base layers, while later rules provide project-specific overlays.

# Local Testing

Test the extension locally against checked-in fixtures representing all configuration styles:

```bash
# 1. Test wildcard multi-layer mapping (~/development/tools/* -> _common + pi-workspace)
bun run test:local

# 2. Test exact path mapping (company-b/client-portal -> portal)
bun run test:local portal

# 3. Test Git worktree autodiscovery (pi-workspace.load inherited by linked worktrees)
bun run test:worktree

# 4. Test main repository checkout for the Git config scenario
bun run test:worktree main
```

# License

[MIT](LICENSE)
