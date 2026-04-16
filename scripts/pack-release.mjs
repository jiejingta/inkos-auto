import { mkdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(scriptDir, "..");
const outputDir = resolve(workspaceRoot, "tmp", "release-packages");
const isWindows = process.platform === "win32";

const packages = [
  { name: "@jiejingtazhu/inkos-core", dir: resolve(workspaceRoot, "packages", "core") },
  { name: "@jiejingtazhu/inkos-studio", dir: resolve(workspaceRoot, "packages", "studio") },
  { name: "@jiejingtazhu/inkos", dir: resolve(workspaceRoot, "packages", "cli") },
];

function runCommand(command, args, options = {}) {
  const resolvedCommand = isWindows && !command.endsWith(".cmd") ? `${command}.cmd` : command;
  const result = spawnSync(resolvedCommand, args, {
    cwd: workspaceRoot,
    env: process.env,
    stdio: "inherit",
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function runPnpm(args) {
  const npmExecPath = process.env.npm_execpath;
  if (!npmExecPath) {
    runCommand("npx", ["pnpm", ...args], { shell: isWindows });
    return;
  }

  const execArgs = /pnpm(?:\.c?js)?$/i.test(npmExecPath)
    ? [npmExecPath, ...args]
    : [npmExecPath, "exec", "pnpm", "--", ...args];
  const result = spawnSync(process.execPath, execArgs, {
    cwd: workspaceRoot,
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function packPackage(packageDir) {
  const npmExecPath = process.env.npm_execpath;
  const command = npmExecPath ? process.execPath : (isWindows ? "npm.cmd" : "npm");
  const args = npmExecPath
    ? [npmExecPath, "pack", "--pack-destination", outputDir]
    : ["pack", "--pack-destination", outputDir];
  const result = spawnSync(command, args, {
    cwd: packageDir,
    env: process.env,
    encoding: "utf-8",
    stdio: "pipe",
    shell: !npmExecPath && isWindows,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    if (result.stdout) {
      process.stdout.write(result.stdout);
    }
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }
    process.exit(result.status ?? 1);
  }

  const lines = `${result.stdout ?? ""}`.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const tarballName = lines.at(-1);
  if (!tarballName?.endsWith(".tgz")) {
    throw new Error(`Failed to detect npm pack output for ${packageDir}`);
  }

  return tarballName;
}

async function main() {
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  runPnpm(["build"]);
  runPnpm(["verify:publish-manifests"]);

  const tarballs = packages.map((pkg) => ({
    name: pkg.name,
    file: (() => {
      const packedFile = packPackage(pkg.dir);
      return isAbsolute(packedFile) ? packedFile : join(outputDir, packedFile);
    })(),
  }));

  process.stdout.write(`\nPacked release artifacts:\n`);
  for (const tarball of tarballs) {
    process.stdout.write(`- ${tarball.name}: ${tarball.file}\n`);
  }
}

await main();
