#!/usr/bin/env bash
set -euo pipefail

GREEN='\033[38;5;46m'
CYAN='\033[38;5;51m'
DIM='\033[2m'
RESET='\033[0m'
DOCKER_CMD="${DOCKER_CMD:-docker}"

resolve_docker() {
  if command -v docker >/dev/null 2>&1; then
    DOCKER_CMD="docker"
    return 0
  fi

  if [ -x /Applications/Docker.app/Contents/Resources/bin/docker ]; then
    DOCKER_CMD="/Applications/Docker.app/Contents/Resources/bin/docker"
    return 0
  fi

  return 1
}

print_logo() {
  printf '\n%b\n' "${GREEN}##   ##   ####   #####  ######   ####    ####${RESET}"
  printf '%b\n' "${GREEN}### ###  ##  ##    ##   ##      ##  ##  ##${RESET}"
  printf '%b\n' "${GREEN}## # ##  ######    ##   ####    ##  ##   ####${RESET}"
  printf '%b\n' "${GREEN}##   ##  ##  ##    ##   ##      ##  ##      ##${RESET}"
  printf '%b\n' "${GREEN}##   ##  ##  ##    ##   ######   ####    ####${RESET}"
  printf '%b\n\n' "${CYAN}MateOS${RESET} ${DIM}assistant operations platform${RESET}"
}

wait_for_docker() {
  if "$DOCKER_CMD" info >/dev/null 2>&1; then
    return 0
  fi

  if [ "$(uname -s)" = "Darwin" ]; then
    printf 'Starting Docker Desktop\n'
    open -a Docker >/dev/null 2>&1 || true
  fi

  for _ in $(seq 1 45); do
    if "$DOCKER_CMD" info >/dev/null 2>&1; then
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
    if "$DOCKER_CMD" compose ps postgres >/dev/null 2>&1 && "$DOCKER_CMD" compose exec -T postgres pg_isready -U postgres -d postgres >/dev/null 2>&1; then
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
  if "$DOCKER_CMD" compose exec -T postgres psql -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${db_name}'" | grep -q 1; then
    return 0
  fi
  "$DOCKER_CMD" compose exec -T postgres psql -U postgres -d postgres -c "CREATE DATABASE \"${db_name}\";"
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
if ! resolve_docker; then
  printf 'Missing required command: docker\n' >&2
  printf 'Install Docker Desktop, then rerun MateOS.\n' >&2
  exit 1
fi

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

if grep -Eq '^DATABASE_URL=postgres://postgres:postgres@(localhost|127\.0\.0\.1):5432/mateos$' .env; then
  sed -i.bak 's#^DATABASE_URL=postgres://postgres:postgres@.*:5432/mateos$#DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/mateos#' .env
  rm -f .env.bak
  printf 'Updated .env DATABASE_URL to postgres://postgres:postgres@127.0.0.1:55432/mateos\n'
fi

printf 'Installing workspace dependencies\n'
pnpm install

printf 'Starting PostgreSQL with Docker Compose\n'
wait_for_docker
"$DOCKER_CMD" compose up -d
wait_for_postgres
ensure_database_exists

printf 'Applying database schema\n'
pnpm db:push

printf '\nMateOS is installed.\n'
printf 'Starting MateOS on localhost\n'
node ./bin/mateos.mjs localhost
