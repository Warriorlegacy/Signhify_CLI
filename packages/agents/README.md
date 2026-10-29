# @signhify/agents

Specialized subagents and swarm orchestration pipeline for Signhify CLI.

## Installation

```bash
npm install @signhify/agents
```

## Agents Included

- **AgentOrchestrator**: DAG-based task execution pipeline supporting topological dependency resolution, parallel concurrency limits, and stateful status transitions (`todo`, `in_progress`, `done`, `failed`).
- **@Editor**: Code modification specialist with automated post-write test verification, lint checks, and self-correcting error recovery loops.
- **@Reviewer**: Architectural and code quality reviewer generating structured diff summaries, security checks, and refactoring recommendations.
- **@Planner**: Requirement decomposition agent creating step-by-step milestones with explicit dependency graphs.
- **@FilePicker**: Intelligent context gatherer selecting relevant project files given user intent.

## License

MIT
