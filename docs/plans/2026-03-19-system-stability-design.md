# System Stability Repair Design

## Goal

Repair the concrete runtime defects found in the review without broad refactors, keeping each fix isolated enough to land as a separate commit.

## Scope

This repair covers six behaviorally distinct problems:

1. Non-atomic book locking and scheduler reentrancy
2. Revision pipeline inconsistency after spot-fix and mismatch between final chapter text and truth files
3. Agent model override client cache reusing the wrong API key/client
4. Daemon startup leaving stale PID files on failure
5. `inkos studio` always launching through `tsx`, even for built JavaScript entries
6. Import resume reporting incorrect counts and totals

Out of scope:

- New features
- CLI UX redesign
- Packaging/cache-permission issues unrelated to application logic
- Large changes to prompt structure or truth-file schema

## Approaches Considered

### Option A: Single broad “stability sweep”

Fix all issues in one pass with one integration-heavy commit.

Pros:

- Fastest to code
- Can share setup changes across files

Cons:

- Hard to review
- Hard to bisect if any regression lands
- Violates the requested per-fix submission style

### Option B: Minimal targeted repairs per defect cluster

Treat each defect cluster as its own TDD cycle with narrow tests and separate commits.

Pros:

- Matches the requested workflow
- Keeps regression surface small
- Makes each behavior change auditable

Cons:

- More commits
- Some repeated test/setup work

Recommendation: Option B.

## Selected Design

### 1. Concurrency and scheduling

Replace the lock’s check-then-write pattern with atomic file creation semantics so only one writer can claim the lock. Add scheduler-side reentrancy protection so a long write cycle cannot overlap with the next timer tick. The lock remains file-based and local to the project; no external coordination is introduced.

### 2. Revision consistency

Use the latest working chapter content as the baseline for follow-up spot-fix revisions instead of falling back to the original draft. When final content changes, recompute and persist truth-file outputs from the final chapter text so chapter summaries and state-adjacent artifacts stay aligned with what was actually written to disk.

### 3. Model override routing

Strengthen the per-agent client cache key so distinct credentials and stream settings do not collapse into the same cached client. Preserve reuse where the effective transport config is identical.

### 4. Daemon startup cleanup

Ensure `inkos up` removes its PID file whenever startup aborts before the scheduler becomes healthy. Keep existing shutdown cleanup behavior.

### 5. Studio launcher

Detect whether the chosen entrypoint is TypeScript or JavaScript and launch with `npx tsx` only for TypeScript. Built JavaScript should run directly with `node`.

### 6. Import resume accounting

Return and log counts for the chapters actually processed during a resumed import, while preserving `nextChapter` semantics based on the full imported corpus.

## Testing Strategy

Each repair starts with a failing automated test:

- `StateManager` tests for concurrent lock acquisition
- `Scheduler` tests for interval overlap behavior
- `PipelineRunner` tests for revision baseline selection, truth-file sync, and import resume counters
- `PipelineRunner` unit test for model override cache isolation
- CLI command tests for daemon PID cleanup and studio launcher command selection

Verification after each batch:

- Targeted package tests
- Relevant typecheck if touched APIs change
- Final full `pnpm test` and `pnpm typecheck`

## Commit Plan

Planned commits:

1. `docs: add system stability repair design and plan`
2. `fix: make book locking atomic and scheduler non-reentrant`
3. `fix: keep revision outputs consistent with final chapter text`
4. `fix: isolate agent override clients by effective config`
5. `fix: clean stale pid files when daemon startup fails`
6. `fix: launch studio with node for built javascript`
7. `fix: report resumed imports using processed chapter counts`
