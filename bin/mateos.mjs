#!/usr/bin/env node

import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_REPO_URL = "https://github.com/logicbaseio/MateOS.git";
const GREEN = "\x1b[38;5;46m";
const CYAN = "\x1b[38;5;51m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

const LOGO = [
  "##   ##   ####   #####  ######   ####    ####",
  "### ###  ##  ##    ##   ##      ##  ##  ##",
  "## # ##  ######    ##   ####    ##  ##   ####",
  "##   ##  ##  ##    ##   ##      ##  ##      ##",
  "##   ##  ##  ##    ##   ######   ####    ####",
];

function printLogo() {
  process.stdout.write(`\n${GREEN}${LOGO.join("\n")}${RESET}\n`);
  process.stdout.write(`${CYAN}MateOS${RESET} ${DIM}assistant operations platform${RESET}\n\n`);
}

function printUsage() {
  printLogo();
  console.log("Usage: mateos [directory]");
  console.log("   or: mateos <command>");
  console.log("");
  console.log("Commands:");
  console.log("  create   Clone and bootstrap MateOS locally");
  console.log("  logo     Show the MateOS terminal logo");
  console.log("  init     Create .env from .env.example if needed");
  console.log("  doctor   Check local prerequisites");
  console.log("  dev      Start API and dashboard together");
}

function runCommand(command, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? process.cwd(),
      stdio: "inherit",
      shell: false,
      ...options,
    });

    child.on("error", rejectPromise);
    child.on("exit", (code, signal) => {
      if (signal) {
        rejectPromise(new Error(`${command} exited via signal ${signal}`));
        return;
      }
      resolvePromise(code ?? 0);
    });
  });
}

function findProjectRoot(startDir) {
  let current = resolve(startDir);
  while (true) {
    const pkgPath = join(current, "package.json");
    const workspacePath = join(current, "pnpm-workspace.yaml");
    const apiPath = join(current, "artifacts", "api-server");
    if (existsSync(pkgPath) && existsSync(workspacePath) && existsSync(apiPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
        if (pkg?.name === "mateos") return current;
      } catch {
        return current;
      }
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function requireProjectRoot() {
  const projectRoot = findProjectRoot(process.cwd());
  if (!projectRoot) {
    console.error("This command must be run inside a MateOS checkout.");
    console.error("Use `npx mateos` first to create one.");
    process.exit(1);
  }
  return projectRoot;
}

async function ensurePnpm() {
  try {
    await runCommand("pnpm", ["--version"], { stdio: "pipe" });
    return;
  } catch {
    try {
      await runCommand("corepack", ["enable"]);
      await runCommand("corepack", ["prepare", "pnpm@latest", "--activate"]);
    } catch {
      console.error("pnpm is required. Install pnpm or enable it through corepack.");
      process.exit(1);
    }
  }
}

async function commandCreate(targetDir = "MateOS") {
  printLogo();
  const repoUrl = process.env.MATEOS_REPO_URL ?? DEFAULT_REPO_URL;

  if (existsSync(resolve(process.cwd(), targetDir))) {
    console.error(`Target already exists: ${targetDir}`);
    process.exit(1);
  }

  for (const [command, args] of [["git", ["--version"]], ["node", ["--version"]], ["docker", ["--version"]]]) {
    try {
      await runCommand(command, args, { stdio: "pipe" });
    } catch {
      console.error(`Missing required command: ${command}`);
      process.exit(1);
    }
  }

  await ensurePnpm();

  console.log(`Cloning MateOS into ${targetDir}`);
  await runCommand("git", ["clone", repoUrl, targetDir]);

  const projectRoot = resolve(process.cwd(), targetDir);
  const envPath = resolve(projectRoot, ".env");
  const envExamplePath = resolve(projectRoot, ".env.example");
  if (!existsSync(envPath) && existsSync(envExamplePath)) {
    copyFileSync(envExamplePath, envPath);
    console.log("Created .env from .env.example");
  }

  console.log("Installing workspace dependencies");
  await runCommand("pnpm", ["install"], { cwd: projectRoot });

  console.log("Starting PostgreSQL with Docker Compose");
  await runCommand("docker", ["compose", "up", "-d"], { cwd: projectRoot });

  console.log("Applying database schema");
  await runCommand("pnpm", ["db:push"], { cwd: projectRoot });

  console.log("");
  console.log("MateOS is installed.");
  console.log(`Next steps:`);
  console.log(`  cd ${targetDir}`);
  console.log("  node ./bin/mateos.mjs doctor");
  console.log("  node ./bin/mateos.mjs dev");
}

async function commandInit() {
  printLogo();
  const root = requireProjectRoot();
  const envPath = resolve(root, ".env");
  const envExamplePath = resolve(root, ".env.example");

  if (existsSync(envPath)) {
    console.log(".env already exists. Nothing changed.");
    return;
  }

  copyFileSync(envExamplePath, envPath);
  console.log("Created .env from .env.example");
}

async function commandDoctor() {
  printLogo();
  const root = requireProjectRoot();

  const checks = [
    ["node", ["--version"]],
    ["pnpm", ["--version"]],
    ["docker", ["--version"]],
  ];

  let failed = false;

  for (const [command, args] of checks) {
    try {
      const code = await runCommand(command, args, { cwd: root, stdio: "pipe" });
      if (code === 0) {
        console.log(`${command}: ok`);
      } else {
        failed = true;
        console.log(`${command}: failed`);
      }
    } catch {
      failed = true;
      console.log(`${command}: missing`);
    }
  }

  console.log("");
  if (failed) {
    console.log("Install the missing prerequisites, then rerun `mateos doctor`.");
    process.exitCode = 1;
    return;
  }

  console.log("Local prerequisites look good.");
}

async function commandDev() {
  printLogo();
  const root = requireProjectRoot();
  if (!existsSync(resolve(root, ".env"))) {
    copyFileSync(resolve(root, ".env.example"), resolve(root, ".env"));
    console.log("Created .env from .env.example");
  }

  const api = spawn("pnpm", ["dev:api"], {
    cwd: root,
    stdio: "inherit",
    shell: false,
  });

  const web = spawn("pnpm", ["dev:web"], {
    cwd: root,
    stdio: "inherit",
    shell: false,
  });

  const shutdown = (code = 0) => {
    api.kill("SIGTERM");
    web.kill("SIGTERM");
    process.exit(code);
  };

  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));

  api.on("exit", (code) => {
    if (code && code !== 0) shutdown(code);
  });

  web.on("exit", (code) => {
    if (code && code !== 0) shutdown(code);
  });
}

const firstArg = process.argv[2];
const knownCommands = new Set(["create", "logo", "init", "doctor", "dev", "help", "--help", "-h"]);
const command = knownCommands.has(firstArg ?? "") ? firstArg : "create";
const createTarget = command === "create" && firstArg && !knownCommands.has(firstArg) ? firstArg : process.argv[3];

switch (command) {
  case "create":
    await commandCreate(createTarget || "MateOS");
    break;
  case "logo":
    printLogo();
    break;
  case "init":
    await commandInit();
    break;
  case "doctor":
    await commandDoctor();
    break;
  case "dev":
    await commandDev();
    break;
  case "help":
  case "--help":
  case "-h":
    printUsage();
    break;
  default:
    printUsage();
    process.exitCode = command === "usage" ? 0 : 1;
}
