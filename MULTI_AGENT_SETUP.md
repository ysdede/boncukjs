# Setting Up a Multi-Agent Environment
> **Goal**: Enable multiple AI agents (e.g., in different IDEs like Cursor and IntelliJ, or separate Cursor Windows) to work on the same codebase coherently using **Git**, **Serena**, and **File-based Syncing**.

## 1. The Trinity of Coordination

To prevents conflicts and hallucinations, we use three distinct layers of state:

1.  **Git (The Hard Truth)**:
    *   **Role**: Source of truth for code.
    *   **Rule**: Agents MUST pull before starting work and push frequently.
    *   **Setup**: Standard Git repo with `main` branch.

2.  **`.agent_sync.md` (The Live Board)**:
    *   **Role**: A "whiteboard" in the repo root for real-time status updates (preventing collisions).
    *   **Rule**: Agents check this first. If "Agent B" is editing `auth.ts`, "Agent A" waits.
    *   **Setup**: A markdown file committed to the repo.

3.  **Serena (The Shared Memory)**:
    *   **Role**: Persistent context and project knowledge (Architecture decisions, "Why did we do this?").
    *   **Rule**: Use `mcp_serena_write_memory` to store high-level decisions.
    *   **Setup**: Install Serena MCP server in both IDEs/Agents.

---

## 2. Setup Instructions for a New Project

### Step A: Initialize the Repo

```bash
git init
echo "# Project Name" > README.md
```

### Step B: Create the Sync File

Create a file named `.agent_sync.md` in the root:

```markdown
# Agent Synchronization Board

## Active Agents
- **Agent A**: [Idle/Active] - @AgentA
- **Agent B**: [Idle/Active] - @AgentB

## Current lock
- [ ] No active locks
- [ ] Active lock: `src/api/` by @AgentA

## Recent Actions
- [x] Initial Setup (Agent A)
```

### Step C: Configure Serena (Memory)

1.   Ensure Serena MCP is running in your agent's config (e.g., `claude_desktop_config.json` or Cursor Settings).
2.  **First Agent Action**:
    *   Call `mcp_serena_activate_project(project="my-new-project")`.
    *   Call `mcp_serena_onboarding()` to bootstrap the project memory.

### Step D: establish Protocol (The "Handshake")

Start your session with a prompt like this to "prime" the agent:

> "I am working in a multi-agent environment.
> 1. Check `.agent_sync.md` for active locks.
> 2. Check `git status` for pending changes.
> 3. Use Serena to read project architecture context.
> 4. Before editing heavy files, update `.agent_sync.md` to lock them."

---

## 3. Workflow Loop

1.  **Start**: `git pull` -> Read `.agent_sync.md`.
2.  **Work**: Update `.agent_sync.md` (Set Status: Active) -> Code -> Test.
3.  **Finish**: `git add .` -> `git commit` -> `git push` -> Update `.agent_sync.md` (Set Status: Idle).

---

## 4. Why this works?

*   **Filesystem Context**: Since agents can read files, `.agent_sync.md` acts as a perfect signaling channel.
*   **Git History**: Prevents code overwrites.
*   **Serena**: Preserves the "Soul" of the project (intentions) across sessions.
