#!/usr/bin/env node

import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stdin as input, stdout as output } from "node:process";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_REPO_URL = "https://github.com/logicbaseio/MateOS.git";
const DEFAULT_NPX_COMMAND = "npx @hamzaashergill/mateos";
const DEFAULT_API_URL = "http://127.0.0.1:8080";
const DEFAULT_WEB_URL = "http://127.0.0.1:5173";
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
  console.log("  brain    Chat with the MateOS Brain from the terminal");
  console.log("  logo     Show the MateOS terminal logo");
  console.log("  init     Create .env from .env.example if needed");
  console.log("  doctor   Check local prerequisites");
  console.log("  dev      Start API and dashboard together");
  console.log("  localhost  Start MateOS locally and print localhost URLs");
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
        if (pkg?.name === "mateos" || pkg?.name === "@hamzaashergill/mateos") return current;
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
    console.error(`Use \`${DEFAULT_NPX_COMMAND}\` first to create one.`);
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

function readEnvValue(root, key) {
  const envPath = resolve(root, ".env");
  if (!existsSync(envPath)) return null;
  const content = readFileSync(envPath, "utf8");
  const match = content.match(new RegExp(`^${key}=(.*)$`, "m"));
  return match?.[1]?.trim() ?? null;
}

async function commandCreate(targetDir = "MateOS") {
  printLogo();
  const repoUrl = process.env.MATEOS_REPO_URL ?? DEFAULT_REPO_URL;

  if (existsSync(resolve(process.cwd(), targetDir))) {
    console.error(`Target already exists: ${targetDir}`);
    process.exit(1);
  }

  for (const [command, args] of [["git", ["--version"]], ["node", ["--version"]]]) {
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

  const databaseUrl = process.env.DATABASE_URL ?? readEnvValue(projectRoot, "DATABASE_URL");
  let hasDocker = false;
  try {
    await runCommand("docker", ["--version"], { stdio: "pipe" });
    hasDocker = true;
  } catch {
    hasDocker = false;
  }

  if (hasDocker) {
    console.log("Starting PostgreSQL with Docker Compose");
    await runCommand("docker", ["compose", "up", "-d"], { cwd: projectRoot });
  } else if (!databaseUrl) {
    console.error("Docker is not installed and no DATABASE_URL is configured.");
    console.error("Install Docker Desktop or set DATABASE_URL in .env, then rerun the setup.");
    process.exit(1);
  } else {
    console.log("Docker not found. Using existing DATABASE_URL from .env.");
  }

  console.log("Applying database schema");
  await runCommand("pnpm", ["db:push"], { cwd: projectRoot });

  console.log("");
  console.log("MateOS is installed.");
  console.log(`Next steps:`);
  console.log(`  cd ${targetDir}`);
  console.log("  node ./bin/mateos.mjs doctor");
  console.log("  node ./bin/mateos.mjs localhost");
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
  ];
  const optionalChecks = [["docker", ["--version"]]];

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

  const databaseUrl = process.env.DATABASE_URL ?? readEnvValue(root, "DATABASE_URL");
  for (const [command, args] of optionalChecks) {
    try {
      const code = await runCommand(command, args, { cwd: root, stdio: "pipe" });
      console.log(`${command}: ${code === 0 ? "ok" : "failed"}`);
    } catch {
      console.log(`${command}: optional`);
    }
  }
  console.log(`database: ${databaseUrl ? "configured" : "missing"}`);

  console.log("");
  if (failed) {
    console.log("Install the missing prerequisites, then rerun `mateos doctor`.");
    process.exitCode = 1;
    return;
  }

  if (!databaseUrl) {
    console.log("Core prerequisites look good. Configure DATABASE_URL or install Docker Desktop for first-time setup.");
    return;
  }

  console.log("Local prerequisites look good.");
}

async function startLocalhost() {
  const root = requireProjectRoot();
  if (!existsSync(resolve(root, ".env"))) {
    copyFileSync(resolve(root, ".env.example"), resolve(root, ".env"));
    console.log("Created .env from .env.example");
  }

  const databaseUrl = process.env.DATABASE_URL ?? readEnvValue(root, "DATABASE_URL");
  let hasDocker = false;
  try {
    await runCommand("docker", ["--version"], { stdio: "pipe" });
    hasDocker = true;
  } catch {
    hasDocker = false;
  }

  if (hasDocker) {
    console.log("Starting PostgreSQL with Docker Compose");
    await runCommand("docker", ["compose", "up", "-d"], { cwd: root });
  } else if (!databaseUrl) {
    console.error("Docker is not installed and no DATABASE_URL is configured.");
    console.error("Set DATABASE_URL in .env to use an existing PostgreSQL instance.");
    process.exit(1);
  }

  console.log("Applying database schema");
  await runCommand("pnpm", ["db:push"], { cwd: root });

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

  console.log("");
  console.log(`MateOS API: ${DEFAULT_API_URL}`);
  console.log(`MateOS Web: ${DEFAULT_WEB_URL}`);
  console.log(`Brain API: ${DEFAULT_API_URL}/api/brain/chat`);
  console.log("Press Ctrl+C to stop.");
}

async function commandDev() {
  printLogo();
  await startLocalhost();
}

async function commandLocalhost() {
  printLogo();
  await startLocalhost();
}

async function commandBrain() {
  printLogo();
  const baseUrl = process.env.MATEOS_API_URL ?? DEFAULT_API_URL;
  console.log(`Brain endpoint: ${baseUrl}/api/brain/chat`);
  console.log("Type `/exit` to quit or `/clear` to clear Brain history.");
  console.log("");

  const rl = createInterface({ input, output });

  while (true) {
    const prompt = await rl.question("brain> ");
    const message = prompt.trim();
    if (!message) continue;
    if (message === "/exit" || message === "/quit") break;

    if (message === "/clear") {
      const clearRes = await fetch(`${baseUrl}/api/brain/messages`, { method: "DELETE" });
      if (!clearRes.ok) {
        console.error(`Failed to clear Brain history (${clearRes.status})`);
      } else {
        console.log("Brain conversation history cleared.");
      }
      continue;
    }

    const res = await fetch(`${baseUrl}/api/brain/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: message }),
    });

    if (!res.ok || !res.body) {
      console.error(`Brain request failed (${res.status})`);
      continue;
    }

    const decoder = new TextDecoder();
    const reader = res.body.getReader();
    let buffer = "";
    let wroteAssistantPrefix = false;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";

      for (const event of events) {
        const line = event.split("\n").find((entry) => entry.startsWith("data: "));
        if (!line) continue;
        const payload = JSON.parse(line.slice(6));
        if (payload.content) {
          if (!wroteAssistantPrefix) {
            process.stdout.write("mateos> ");
            wroteAssistantPrefix = true;
          }
          process.stdout.write(payload.content);
        } else if (payload.tool && payload.status === "done") {
          if (wroteAssistantPrefix) process.stdout.write("\n");
          console.log(`[tool:${payload.tool}] ${payload.summary ?? "done"}`);
          wroteAssistantPrefix = false;
        } else if (payload.error) {
          if (wroteAssistantPrefix) process.stdout.write("\n");
          console.error(payload.error);
          wroteAssistantPrefix = false;
        }
      }
    }

    if (wroteAssistantPrefix) process.stdout.write("\n");
  }

  rl.close();
}

const firstArg = process.argv[2];
const knownCommands = new Set(["create", "brain", "logo", "init", "doctor", "dev", "localhost", "help", "--help", "-h"]);
const command = knownCommands.has(firstArg ?? "") ? firstArg : "create";
const createTarget = command === "create" && firstArg && !knownCommands.has(firstArg) ? firstArg : process.argv[3];

switch (command) {
  case "create":
    await commandCreate(createTarget || "MateOS");
    break;
  case "brain":
    await commandBrain();
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
  case "localhost":
    await commandLocalhost();
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
