/* ── Auto-init & environment detection for TUI ── */

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, basename } from "node:path";
import readline from "node:readline/promises";
import { c, bold, cyan, green, yellow, gray, dim, red, reset } from "./ansi.js";
import { GLOBAL_ENV_PATH } from "../utils.js";

const PROVIDERS = ["openai", "anthropic", "custom"] as const;

interface SetupResult {
  readonly projectRoot: string;
  readonly hasLlmConfig: boolean;
}

export async function ensureProject(cwd: string): Promise<SetupResult> {
  const configPath = join(cwd, "inkos.json");
  const hasConfig = await fileExists(configPath);

  if (!hasConfig) {
    await autoInit(cwd);
  }

  const hasLlm = await hasLlmConfig(cwd);
  return { projectRoot: cwd, hasLlmConfig: hasLlm };
}

export async function interactiveLlmSetup(
  projectRoot: string,
): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    console.log();
    console.log(c("  LLM 配置向导", bold, cyan));
    console.log(c("  Configure your LLM provider to start writing.", dim));
    console.log();

    const providerInput = await rl.question(
      c("  Provider ", gray) +
        c("(openai/anthropic/custom)", dim) +
        c(": ", gray),
    );
    const provider = PROVIDERS.includes(providerInput.trim() as typeof PROVIDERS[number])
      ? providerInput.trim()
      : "openai";

    const baseUrl = await rl.question(
      c("  Base URL ", gray) +
        c("(API endpoint)", dim) +
        c(": ", gray),
    );

    const apiKey = await rl.question(
      c("  API Key ", gray) +
        c(": ", gray),
    );

    const model = await rl.question(
      c("  Model ", gray) +
        c("(e.g. gpt-4o, claude-sonnet-4-20250514)", dim) +
        c(": ", gray),
    );

    const scope = await rl.question(
      c("  Save to ", gray) +
        c("(global/project)", dim) +
        c(" [global]: ", gray),
    );

    const useGlobal = scope.trim().toLowerCase() !== "project";

    const envContent = [
      `INKOS_LLM_PROVIDER=${provider}`,
      `INKOS_LLM_BASE_URL=${baseUrl.trim()}`,
      `INKOS_LLM_API_KEY=${apiKey.trim()}`,
      `INKOS_LLM_MODEL=${model.trim()}`,
    ].join("\n");

    if (useGlobal) {
      const globalDir = join(GLOBAL_ENV_PATH, "..");
      await mkdir(globalDir, { recursive: true });
      await writeFile(GLOBAL_ENV_PATH, envContent + "\n", "utf-8");
      console.log(c(`  ✓ Saved to ${GLOBAL_ENV_PATH}`, green));
    } else {
      await writeFile(join(projectRoot, ".env"), envContent + "\n", "utf-8");
      console.log(c("  ✓ Saved to .env", green));
    }
    console.log();
  } finally {
    rl.close();
  }
}

async function autoInit(cwd: string): Promise<void> {
  const projectName = basename(cwd);
  console.log(c(`  Auto-initializing project in ${projectName}/ ...`, dim));

  await mkdir(join(cwd, "books"), { recursive: true });
  await mkdir(join(cwd, "radar"), { recursive: true });

  const config = {
    name: projectName,
    version: "0.1.0",
    language: "zh",
    llm: {
      provider: process.env.INKOS_LLM_PROVIDER ?? "openai",
      baseUrl: process.env.INKOS_LLM_BASE_URL ?? "",
      model: process.env.INKOS_LLM_MODEL ?? "",
    },
    notify: [],
    daemon: {
      schedule: {
        radarCron: "0 */6 * * *",
        writeCron: "*/15 * * * *",
      },
      maxConcurrentBooks: 3,
    },
  };

  await writeFile(
    join(cwd, "inkos.json"),
    JSON.stringify(config, null, 2),
    "utf-8",
  );

  const hasGlobal = await hasGlobalConfig();
  if (!hasGlobal) {
    await writeFile(
      join(cwd, ".env"),
      [
        "# LLM Configuration — run inkos tui to configure interactively",
        "INKOS_LLM_PROVIDER=openai",
        "INKOS_LLM_BASE_URL=",
        "INKOS_LLM_API_KEY=",
        "INKOS_LLM_MODEL=",
      ].join("\n"),
      "utf-8",
    );
  }

  await writeFile(
    join(cwd, ".gitignore"),
    [".env", "node_modules/", ".DS_Store"].join("\n"),
    "utf-8",
  );

  console.log(c("  ✓ Project initialized", green));
}

async function hasLlmConfig(projectRoot: string): Promise<boolean> {
  // Check project .env first
  const projectEnv = join(projectRoot, ".env");
  if (await checkEnvForKey(projectEnv)) return true;
  // Check global
  return checkEnvForKey(GLOBAL_ENV_PATH);
}

async function hasGlobalConfig(): Promise<boolean> {
  return checkEnvForKey(GLOBAL_ENV_PATH);
}

async function checkEnvForKey(envPath: string): Promise<boolean> {
  try {
    const content = await readFile(envPath, "utf-8");
    const match = content.match(/INKOS_LLM_API_KEY=(.+)/);
    return !!match && match[1]!.trim().length > 0 && !match[1]!.includes("your-api-key");
  } catch {
    return false;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
