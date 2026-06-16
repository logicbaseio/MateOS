#!/usr/bin/env node

import { copyFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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
  console.log("Usage: mateos <command>");
  console.log("");
  console.log("Commands:");
  console.log("  logo     Show the MateOS terminal logo");
  console.log("  init     Create .env from .env.example if needed");
  console.log("  doctor   Check local prerequisites");
  console.log("  dev      Start API and dashboard together");
}

function runCommand(command, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: ROOT,
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

async function commandInit() {
  printLogo();
  const envPath = resolve(ROOT, ".env");
  const envExamplePath = resolve(ROOT, ".env.example");

  if (existsSync(envPath)) {
    console.log(".env already exists. Nothing changed.");
    return;
  }

  copyFileSync(envExamplePath, envPath);
  console.log("Created .env from .env.example");
}

async function commandDoctor() {
  printLogo();

  const checks = [
    ["node", ["--version"]],
    ["pnpm", ["--version"]],
    ["docker", ["--version"]],
  ];

  let failed = false;

  for (const [command, args] of checks) {
    try {
      const code = await runCommand(command, args, { stdio: "pipe" });
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
  if (!existsSync(resolve(ROOT, ".env"))) {
    copyFileSync(resolve(ROOT, ".env.example"), resolve(ROOT, ".env"));
    console.log("Created .env from .env.example");
  }

  const api = spawn("pnpm", ["dev:api"], {
    cwd: ROOT,
    stdio: "inherit",
    shell: false,
  });

  const web = spawn("pnpm", ["dev:web"], {
    cwd: ROOT,
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

const command = process.argv[2] ?? "usage";

switch (command) {
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
  default:
    printUsage();
    process.exitCode = command === "usage" ? 0 : 1;
}
