# Documentation

Start with the repository [README](../README.md) for setup and product overview. Commands and code paths in developer guides are relative to the repository root.

## Developer guides

- [Codex guide](CODEX.md): local commands, repository map, verification, and handoff guidance.
- [Claude Code guide](../CLAUDE.md): Claude-specific tool rules, a dated summary of the current state, and a doc map that notes each document's age. Claude Code loads it automatically, together with `AGENTS.md`.
- [Agent instructions](../AGENTS.md): project rules, implementation ownership, and action boundaries. This file stays at the repository root for agent discovery.

## Design references

- [Tenant-ready architecture diagrams](../architecture/tenant-ready/README.md): the proposed club and venue model. These are proposals, not deployment evidence.

## Feature workflows

- [Help and Inquiry Workflow](HELP-AND-INQUIRY-WORKFLOW.md): role-aware Help, inquiry handling, dependencies, and known gaps.

## Handoffs

- Multi-tenant SaaS and superadmin handoff (removed from the working tree; read it with `git show 1f21c92:RALLY-POINT-TENANCY-HANDOFF.pdf > handoff.pdf`): PR #3's handoff (2026-10-14) for branches, the superadmin portal, and the commission ledger. It is history now: on 2026-10-17 its branches became clubs on the club and venue model, and its migration was replaced. The [Claude Code guide](../CLAUDE.md) has the current state. It is not release approval.

## Local-only references and evidence

Most of `docs/` is intentionally Git-ignored. These files may exist in the original workspace but are not included in a fresh clone:

- Product and architecture: `PRD.md`, `ARCHITECTURE-ESSENTIALS.md`, `ARCHITECTURE.md`, `CODEX-NAVIGATION-GUIDE.md`, and `architecture/`.
- Release planning and reports: `TENANT-READY-*.md`, `STAGING-*.md`, `PRIVACY-*.md`, and other dated audit records.
- Verification notes: `testing/`.
- Private release packages and immutable evidence: `release-private/`.

Do not move, rewrite, or publish private packages or historical evidence while organizing shared documentation. Keep new shared guides explicitly allowlisted in `.gitignore`; do not remove the broad `docs/*` ignore rule.
