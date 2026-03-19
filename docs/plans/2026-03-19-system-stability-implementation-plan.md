# System Stability Repair Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Repair the reviewed runtime defects with isolated TDD-driven fixes and separate commits.

**Architecture:** Keep the existing architecture intact and apply narrow behavior corrections at the lock, scheduler, pipeline, and CLI edges. Each task adds a failing test first, implements the smallest fix that passes, and lands in its own commit.

**Tech Stack:** TypeScript, Node.js, Vitest, Commander, pnpm workspaces

---

### Task 1: Atomic Locking And Non-Reentrant Scheduling

**Files:**
- Modify: `packages/core/src/__tests__/state-manager.test.ts`
- Modify: `packages/core/src/pipeline/scheduler.ts`
- Create/Modify: `packages/core/src/__tests__/scheduler.test.ts`
- Modify: `packages/core/src/state/manager.ts`

**Step 1: Write the failing tests**

- Add a lock race test that starts two acquisitions at once and expects only one success.
- Add a scheduler test that triggers overlapping timer ticks and expects only one write cycle to run at a time.

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @actalk/inkos-core test -- --runInBand src/__tests__/state-manager.test.ts src/__tests__/scheduler.test.ts`

Expected: failures showing concurrent lock acquisition and/or overlapping cycle execution.

**Step 3: Write minimal implementation**

- Switch lock creation to atomic open/write semantics.
- Track in-flight write/radar cycles and skip/reject reentry while a cycle is already running.

**Step 4: Run tests to verify they pass**

Run the same targeted test command and confirm green.

**Step 5: Commit**

```bash
git add packages/core/src/state/manager.ts packages/core/src/pipeline/scheduler.ts packages/core/src/__tests__/state-manager.test.ts packages/core/src/__tests__/scheduler.test.ts
git commit -m "fix: make book locking atomic and scheduler non-reentrant"
```

### Task 2: Revision Consistency With Final Chapter Text

**Files:**
- Create/Modify: `packages/core/src/__tests__/pipeline-runner.test.ts`
- Modify: `packages/core/src/pipeline/runner.ts`

**Step 1: Write the failing tests**

- Test that the second spot-fix revision uses the already-fixed content as input.
- Test that persisted truth-file outputs match the final revised chapter rather than the original writer output.

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @actalk/inkos-core test -- src/__tests__/pipeline-runner.test.ts`

Expected: assertions showing stale baseline use and stale truth-file writes.

**Step 3: Write minimal implementation**

- Feed the current `finalContent` into follow-up revision.
- Persist truth-file outputs derived from the final content path.

**Step 4: Run tests to verify they pass**

Run the same targeted test file and confirm green.

**Step 5: Commit**

```bash
git add packages/core/src/pipeline/runner.ts packages/core/src/__tests__/pipeline-runner.test.ts
git commit -m "fix: keep revision outputs consistent with final chapter text"
```

### Task 3: Agent Override Client Cache Isolation

**Files:**
- Modify: `packages/core/src/__tests__/pipeline-runner.test.ts`
- Modify: `packages/core/src/pipeline/runner.ts`

**Step 1: Write the failing test**

- Add a test showing two overrides with the same base URL but different credential/env settings must not reuse the same cached client.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @actalk/inkos-core test -- src/__tests__/pipeline-runner.test.ts`

Expected: failure proving the same client instance is reused incorrectly.

**Step 3: Write minimal implementation**

- Expand the cache key to cover the effective transport/auth config that determines client identity.

**Step 4: Run test to verify it passes**

Run the same targeted test file and confirm green.

**Step 5: Commit**

```bash
git add packages/core/src/pipeline/runner.ts packages/core/src/__tests__/pipeline-runner.test.ts
git commit -m "fix: isolate agent override clients by effective config"
```

### Task 4: Daemon PID Cleanup On Startup Failure

**Files:**
- Modify: `packages/cli/src/__tests__/cli-integration.test.ts` or add focused daemon command test
- Modify: `packages/cli/src/commands/daemon.ts`

**Step 1: Write the failing test**

- Simulate a startup failure after PID creation and assert the PID file is removed.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @actalk/inkos test -- src/__tests__/cli-integration.test.ts`

Expected: PID file remains after a failed startup.

**Step 3: Write minimal implementation**

- Wrap startup cleanup so the PID file is removed on failed boot paths.

**Step 4: Run test to verify it passes**

Run the same targeted CLI test and confirm green.

**Step 5: Commit**

```bash
git add packages/cli/src/commands/daemon.ts packages/cli/src/__tests__/cli-integration.test.ts
git commit -m "fix: clean stale pid files when daemon startup fails"
```

### Task 5: Studio Launcher Runtime Selection

**Files:**
- Create/Modify: `packages/cli/src/__tests__/studio.test.ts`
- Modify: `packages/cli/src/commands/studio.ts`

**Step 1: Write the failing tests**

- Test that a `.ts` entry launches through `npx tsx`.
- Test that a `.js` entry launches through `node`.

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @actalk/inkos test -- src/__tests__/studio.test.ts`

Expected: built JavaScript path still routes through `tsx`.

**Step 3: Write minimal implementation**

- Factor command selection from entrypoint extension and use the proper runtime.

**Step 4: Run tests to verify they pass**

Run the same targeted test file and confirm green.

**Step 5: Commit**

```bash
git add packages/cli/src/commands/studio.ts packages/cli/src/__tests__/studio.test.ts
git commit -m "fix: launch studio with node for built javascript"
```

### Task 6: Resume Import Accounting

**Files:**
- Modify: `packages/core/src/__tests__/pipeline-runner.test.ts`
- Modify: `packages/core/src/pipeline/runner.ts`

**Step 1: Write the failing test**

- Add a resume import test that starts from a later chapter and asserts `importedCount` and `totalWords` reflect only processed chapters in that run.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @actalk/inkos-core test -- src/__tests__/pipeline-runner.test.ts`

Expected: return values count the whole corpus instead of the resumed slice.

**Step 3: Write minimal implementation**

- Track processed chapter count and processed-word total separately from full corpus size.

**Step 4: Run test to verify it passes**

Run the same targeted test file and confirm green.

**Step 5: Commit**

```bash
git add packages/core/src/pipeline/runner.ts packages/core/src/__tests__/pipeline-runner.test.ts
git commit -m "fix: report resumed imports using processed chapter counts"
```

### Task 7: Final Verification

**Files:**
- No code changes expected

**Step 1: Run full verification**

Run:

```bash
pnpm typecheck
pnpm test
```

Expected: all targeted fixes pass together. If the packaging test still fails due to local npm cache permissions, note that explicitly and verify all application-level tests separately.

**Step 2: Summarize final state**

- Record commit list
- Record any environment-specific residual issue
