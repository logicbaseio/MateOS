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

wait_for_docker() {
  if docker info >/dev/null 2>&1; then
    return 0
  fi

  if [ "$(uname -s)" = "Darwin" ]; then
    printf 'Starting Docker Desktop\n'
    open -a Docker >/dev/null 2>&1 || true
  fi

  for _ in $(seq 1 45); do
    if docker info >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done

  printf 'Docker is installed but not ready. Start Docker Desktop and rerun MateOS.\n' >&2
  exit 1
}

wait_for_postgres() {
  printf 'Waiting for PostgreSQL to become ready\n'
  for _ in $(seq 1 45); do
    if docker compose ps postgres >/dev/null 2>&1 && docker compose exec -T postgres pg_isready -U postgres -d postgres >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done

  printf 'PostgreSQL did not become ready in time.\n' >&2
  exit 1
}

ensure_database_exists() {
  local db_name="mateos"
  printf 'Ensuring PostgreSQL database exists: %s\n' "$db_name"
  if docker compose exec -T postgres psql -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${db_name}'" | grep -q 1; then
    return 0
  fi
  docker compose exec -T postgres psql -U postgres -d postgres -c "CREATE DATABASE \"${db_name}\";"
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
wait_for_docker
docker compose up -d
wait_for_postgres
ensure_database_exists

printf 'Applying database schema\n'
pnpm db:push

printf '\nMateOS is installed.\n'
printf 'Starting MateOS on localhost\n'
node ./bin/mateos.mjs localhost
