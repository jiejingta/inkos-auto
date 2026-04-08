/* ── InkOS TUI — Claude Code-style persistent REPL ── */

import { basename } from "node:path";
import readline from "node:readline/promises";
import {
  appendInteractionMessage,
  processProjectInteractionInput,
  type InteractionRuntimeTools,
} from "@actalk/inkos-core";
import {
  loadProjectSession,
  persistProjectSession,
  resolveSessionActiveBook,
} from "./session-store.js";
import { createInteractionTools } from "./tools.js";
import { formatTuiResult } from "./output.js";
import { ensureProject, interactiveLlmSetup } from "./setup.js";
import {
  c,
  bold,
  dim,
  cyan,
  green,
  yellow,
  gray,
  magenta,
  red,
  blue,
  brightCyan,
  brightWhite,
  reset,
  box,
  hr,
  clearLine,
  hideCursor,
  showCursor,
} from "./ansi.js";

/* ── Version ── */

async function readVersion(): Promise<string> {
  try {
    const { readFile } = await import("node:fs/promises");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf-8"));
    return pkg.version ?? "dev";
  } catch {
    return "dev";
  }
}

/* ── Welcome screen ── */

function printWelcome(version: string, projectName: string, bookTitle?: string): void {
  console.log();
  console.log(
    box([
      `  ${c("InkOS", bold, brightCyan)}${c(` v${version}`, dim)}`,
      `  ${c("Autonomous Novel Writing AI Agent", dim)}`,
    ]),
  );
  console.log();

  const info = [
    `  ${c("Project", gray)}  ${c(projectName, brightWhite)}`,
    `  ${c("Book", gray)}     ${bookTitle ? c(bookTitle, brightWhite) : c("none — run /books or create one", dim)}`,
  ];
  console.log(info.join("\n"));
  console.log();
  console.log(c("  Type a command or describe what you want to do.", dim));
  console.log(c("  /help for commands, /quit to exit.", dim));
  console.log();
}

/* ── Help ── */

function printHelp(): void {
  const commands = [
    ["/write", "Write the next chapter (full pipeline)"],
    ["/books", "List all books"],
    ["/open <book>", "Select active book"],
    ["/mode <auto|semi|manual>", "Switch automation mode"],
    ["/focus <text>", "Update current focus for next chapters"],
    ["/rewrite <n>", "Rewrite chapter N"],
    ["/status", "Show current status"],
    ["/help", "Show this help"],
    ["/quit", "Exit InkOS TUI"],
  ];

  console.log();
  console.log(c("  Commands", bold, cyan));
  console.log();
  for (const [cmd, desc] of commands) {
    console.log(`  ${c(cmd!, green)}  ${c(desc!, dim)}`);
  }
  console.log();
  console.log(c("  You can also type in natural language:", dim));
  console.log(c('  "继续写" / "写下一章" / "暂停" / "把林烬改成张三"', dim));
  console.log();
}

/* ── Spinner ── */

class Spinner {
  private interval: ReturnType<typeof setInterval> | undefined;
  private frame = 0;
  private readonly frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

  start(message: string): void {
    this.frame = 0;
    process.stdout.write(hideCursor);
    this.interval = setInterval(() => {
      const f = this.frames[this.frame % this.frames.length];
      process.stdout.write(`${clearLine}  ${c(f!, cyan)} ${c(message, dim)}`);
      this.frame++;
    }, 80);
  }

  stop(message?: string): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
    process.stdout.write(`${clearLine}${showCursor}`);
    if (message) {
      console.log(`  ${c("✓", green)} ${c(message, dim)}`);
    }
  }
}

/* ── Process input ── */

async function processInput(
  projectRoot: string,
  input: string,
  tools: InteractionRuntimeTools,
  spinner: Spinner,
): Promise<string | undefined> {
  spinner.start("Processing...");
  try {
    const result = await processProjectInteractionInput({
      projectRoot,
      input,
      tools,
    });
    const summary = formatTuiResult({
      intent: result.request.intent,
      status: result.session.currentExecution?.status ?? "completed",
      bookId: result.session.activeBookId,
      mode: result.request.mode,
      responseText: result.responseText,
    });
    const nextSession = appendInteractionMessage(result.session, {
      role: "assistant",
      content: summary,
      timestamp: Date.now(),
    });
    await persistProjectSession(projectRoot, nextSession);
    spinner.stop();
    return summary;
  } catch (err) {
    spinner.stop();
    const msg = err instanceof Error ? err.message : String(err);
    return `Error: ${msg}`;
  }
}

/* ── Status command ── */

async function printStatus(projectRoot: string): Promise<void> {
  try {
    const session = await loadProjectSession(projectRoot);
    const bookId = await resolveSessionActiveBook(projectRoot, session);
    console.log();
    console.log(`  ${c("Mode", gray)}     ${c(session.automationMode, yellow)}`);
    console.log(`  ${c("Book", gray)}     ${bookId ? c(bookId, brightWhite) : c("none", dim)}`);
    console.log(`  ${c("Status", gray)}   ${c(session.currentExecution?.status ?? "idle", green)}`);
    if (session.events.length > 0) {
      console.log(`  ${c("Events", gray)}   ${c(String(session.events.length), brightWhite)}`);
      const recent = session.events.slice(-3);
      for (const ev of recent) {
        console.log(`           ${c(`${ev.kind}: ${ev.detail ?? ev.status}`, dim)}`);
      }
    }
    console.log();
  } catch {
    console.log(c("  Could not load session.", dim));
    console.log();
  }
}

/* ── Legacy exports for tests ── */

export interface TuiFrameState {
  readonly projectName: string;
  readonly activeBookTitle?: string;
  readonly automationMode: string;
  readonly status: string;
  readonly messages?: ReadonlyArray<string>;
  readonly events?: ReadonlyArray<string>;
}

export function renderTuiFrame(state: TuiFrameState): string {
  const lines = [
    `Project: ${state.projectName}`,
    `Book: ${state.activeBookTitle ?? "none"}`,
    `Mode: ${state.automationMode}`,
    `Stage: ${state.status}`,
    "",
    "Messages:",
    ...(state.messages?.length
      ? state.messages.slice(-3).map((message) => `- ${message}`)
      : ["- (empty)"]),
    "",
    "Events:",
    ...(state.events?.length
      ? state.events.slice(-3).map((event) => `- ${event}`)
      : ["- (empty)"]),
    "",
    "> ",
  ];
  return lines.join("\n");
}

export async function processTuiInput(
  projectRoot: string,
  input: string,
  tools: InteractionRuntimeTools,
) {
  const result = await processProjectInteractionInput({
    projectRoot,
    input,
    tools,
  });
  const summary = formatTuiResult({
    intent: result.request.intent,
    status: result.session.currentExecution?.status ?? "completed",
    bookId: result.session.activeBookId,
    mode: result.request.mode,
    responseText: result.responseText,
  });
  const nextSession = appendInteractionMessage(result.session, {
    role: "assistant",
    content: summary,
    timestamp: Date.now(),
  });
  await persistProjectSession(projectRoot, nextSession);
  return { ...result, session: nextSession };
}

/* ── Main REPL ── */

export async function launchTui(
  projectRoot: string,
  toolsOverride?: InteractionRuntimeTools,
): Promise<void> {
  // 1. Auto-setup
  const { hasLlmConfig } = await ensureProject(projectRoot);

  // 2. LLM config if missing
  if (!hasLlmConfig) {
    console.log();
    console.log(c("  No LLM configuration found.", yellow));
    console.log(c("  Let's set up your API provider first.", dim));
    await interactiveLlmSetup(projectRoot);
  }

  // 3. Load session
  const session = await loadProjectSession(projectRoot);
  const activeBookId = await resolveSessionActiveBook(projectRoot, session);
  const version = await readVersion();

  // 4. Welcome
  printWelcome(version, basename(projectRoot), activeBookId);

  // 5. Bail if not interactive
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return;
  }

  // 6. Build tools
  let tools: InteractionRuntimeTools;
  try {
    tools = toolsOverride ?? (await createInteractionTools(projectRoot));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(c(`  Failed to initialize: ${msg}`, red));
    console.log(c("  Check your .env or run: inkos config set-global", dim));
    console.log();
    return;
  }

  // 7. REPL loop
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${c("❯", cyan)} `,
  });
  const spinner = new Spinner();

  const cleanup = () => {
    process.stdout.write(showCursor);
    rl.close();
  };

  process.on("SIGINT", () => {
    spinner.stop();
    console.log();
    console.log(c("  Bye!", dim));
    cleanup();
    process.exit(0);
  });

  rl.prompt();

  for await (const line of rl) {
    const input = line.trim();

    if (!input) {
      rl.prompt();
      continue;
    }

    // Built-in TUI commands
    if (/^\/quit$/i.test(input) || /^\/exit$/i.test(input) || /^(quit|exit|bye)$/i.test(input)) {
      console.log(c("  Bye!", dim));
      break;
    }

    if (/^\/help$/i.test(input) || /^(help|帮助)$/i.test(input)) {
      printHelp();
      rl.prompt();
      continue;
    }

    if (/^\/status$/i.test(input) || /^(status|状态)$/i.test(input)) {
      await printStatus(projectRoot);
      rl.prompt();
      continue;
    }

    if (/^\/clear$/i.test(input)) {
      console.clear();
      rl.prompt();
      continue;
    }

    // Delegate to interaction layer
    const result = await processInput(projectRoot, input, tools, spinner);
    if (result) {
      console.log();
      // Indent each line of result
      for (const resultLine of result.split("\n")) {
        console.log(`  ${resultLine}`);
      }
      console.log();
    }

    rl.prompt();
  }

  cleanup();
}
