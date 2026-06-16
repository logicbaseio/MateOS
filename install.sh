#!/usr/bin/env bash
set -euo pipefail

GREEN='\033[38;5;46m'
CYAN='\033[38;5;51m'
DIM='\033[2m'
RESET='\033[0m'

print_logo() {
  printf '\n%b\n' "${GREEN}##   ##   ####   #####  ######   ####    ####${RESET}"
  printf '%b\n' "${GREEN}### ###  ##  ##    ##   ##      ##  ##  ##${RESET}"
  printf '%b\n' "${GREEN}## # ##  ######    ##   ####    ##  ##   ####${RESET}"
  printf '%b\n' "${GREEN}##   ##  ##  ##    ##   ##      ##  ##      ##${RESET}"
  printf '%b\n' "${GREEN}##   ##  ##  ##    ##   ######   ####    ####${RESET}"
  printf '%b\n\n' "${CYAN}MateOS${RESET} ${DIM}assistant operations platform${RESET}"
}

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

TARGET_DIR="${1:-MateOS}"
REPO_URL="${MATEOS_REPO_URL:-https://github.com/logicbaseio/MateOS.git}"

print_logo
need_cmd git
need_cmd node
need_cmd docker

if ! command -v pnpm >/dev/null 2>&1; then
  if command -v corepack >/dev/null 2>&1; then
    corepack enable >/dev/null 2>&1 || true
    corepack prepare pnpm@latest --activate >/dev/null 2>&1 || true
  fi
fi

need_cmd pnpm

if [ -e "$TARGET_DIR" ]; then
  printf 'Target already exists: %s\n' "$TARGET_DIR" >&2
  exit 1
fi

printf 'Cloning MateOS into %s\n' "$TARGET_DIR"
git clone "$REPO_URL" "$TARGET_DIR"
cd "$TARGET_DIR"

if [ ! -f .env ]; then
  cp .env.example .env
  printf 'Created .env from .env.example\n'
fi

printf 'Installing workspace dependencies\n'
pnpm install

printf 'Starting PostgreSQL with Docker Compose\n'
docker compose up -d

printf 'Applying database schema\n'
pnpm db:push

printf '\nMateOS is installed.\n'
printf 'Next steps:\n'
printf '  cd %s\n' "$TARGET_DIR"
printf '  node ./bin/mateos.mjs doctor\n'
printf '  node ./bin/mateos.mjs dev\n'
