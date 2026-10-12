# AI Agent Instructions

These instructions govern all AI agents working on this codebase.

## Core Directives
- **Communication:** Communicate in English. Refer to yourself as "I/Me" and the user as "You".
- **Session Startup:** Start every session by reading [README.md](file:///d:/CatNonHelper/README.md) and following the instruction order.
- **Priority:** Always follow the latest prompt from the user before reading instructions provided in documents.
- **Search Before Reading:** Search file names, symbols, and keywords before opening large files (use `rg` or targeted tools where available).
- **Token Efficiency:** Read only necessary sections. Do not re-read files you already understand unless they have changed.
- **Minimal Edits:** Keep editing minimal. Preserve existing patterns, style conventions, and tools previously used.
- **No Unnecessary Abstractions:** Do not refactor, introduce document abstractions, or write unit tests that do not directly benefit the active scope.
- **Targeted Testing:** Test with minimal commands that best fit the changes made.
- **Scope Expansion:** Expand testing and analysis scope only if there is insufficient information, unclear dependencies, impacts on shared infrastructure, or errors encountered.
- **Fresh Testing:** Do not reuse old testing results as new ones, and never pretend tests were executed when they were not.
- **Security & Privacy:** Never collect or log secrets, tokens, passwords, or personal data inside documents or logs.
- **Environment Caution:** Do not automatically assume an environment named "Test" is a safe sandbox.
- **Reporting:** Report every change, decision, limitation, test result, and next action clearly.

## Context Navigation Sequence
Every agent session must strictly follow this order:
1. [README.md](file:///d:/CatNonHelper/README.md)
2. [Context/Rules.md](file:///d:/CatNonHelper/Context/Rules.md) + [Context/Status.md](file:///d:/CatNonHelper/Context/Status.md)
3. Active Quest Board in [Context/Agent-Handoff.md](file:///d:/CatNonHelper/Context/Agent-Handoff.md)
4. Relevant Quests in `Context/quests/`
5. Task-specific documents or source code only as required

Agents must first read the names, statuses, and owners of all open tasks, then read details only for tasks that are relevant or have overlapping scopes. Do not automatically read Edit Log, archives, or full file trees.

## Multi-Agent Collaboration Rules
- **Subagent Invocations:** Launch additional agents only when explicitly instructed by the user.
- **Ownership:** Every Quest must have a clearly defined owner.
- **Scope Checking:** Before modifying any file, check the scope of any active Quests. If scopes overlap, resolve ownership with the user before making changes.
- **No Hijacking:** Do not modify, close, or take over another agent's Quest on your own initiative. Change the owner only when instructed to take over.
- **Atomic Updates:** Before updating a Quest or document, read the latest file version and apply only your own patches. Never overwrite using an old snapshot.
- **Task Longevity:** Do not assume a task is abandoned simply because time has passed.
- **Unlogged Code Changes & Drift Tolerance:** Other AI agents or the user may modify code and files directly without updating status files, Quest boards, or the Edit Log. Therefore, documentation and logs may contain inaccuracies or drift. Always verify the actual source code and file state on disk rather than assuming status logs are 100% synchronized. If unlogged changes are detected, do not revert or discard them without explicit confirmation from the user.

## Task Tracking via Quests
All open tasks are tracked individually in `Context/quests/` using the format `Q-YYYYMMDD-short-name.md`.
Template:
```markdown
### YYYY-MM-DD — Q-ID — Project Name
- Status: active | waiting | blocked | ready-to-close
- Owner: Actual agent/chat name or thread ID
- Goal: Inspection results and criteria.
- Files: A clearly defined path, do not use the word "all".
- Context: Links to necessary documents or evidence
- Validation: Actual test results, or an indication that the test has not yet been performed.
- Next action: Next steps and what to expect
```

Statuses:
- `active`: In progress
- `waiting`: Awaiting information, a decision, or a handover
- `blocked`: Progress stalled (blocker and next action must be identified)
- `ready-to-close`: Criteria met and logged, awaiting user confirmation to close

## Logging Protocol
When completing a task or handing over work:
- Run `python tools/context/log-edit.py --quest <Q-ID> --files "<files>" --summary "<summary>" --validation "<validation>"`
- Do not log on every intermediate save; log once upon task completion or handover.

## Topic Notes
The primary agent interacting with the user maintains the latest summary at `C:/Users/ASUS/ChatGPT-Current-Topic/latest.md` (or user-defined `CURRENT_TOPIC_PATH`). Overwrite when the topic changes or major decisions are made. Read `latest.md` before new voice or interaction sessions as contextual reference.
