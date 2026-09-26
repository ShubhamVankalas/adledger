#!/usr/bin/env sh
# AdLedger one-line installer for Linux/macOS servers:
#   curl -fsSL https://raw.githubusercontent.com/ShubhamVankalas/adledger/main/install.sh | sh
#
# Creates ./adledger with docker-compose.yml + a .env holding generated secrets,
# then starts AdLedger. Re-running it upgrades to the latest image.
set -eu

REPO_RAW="${ADLEDGER_RAW:-https://raw.githubusercontent.com/ShubhamVankalas/adledger/main}"
DIR="${ADLEDGER_DIR:-adledger}"

say() { printf '\033[1;32m▸\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die "Docker is required. Install it from https://docs.docker.com/get-docker/ (or: curl -fsSL https://get.docker.com | sh)"
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required (docker compose ...)."

mkdir -p "$DIR" && cd "$DIR"
say "Downloading docker-compose.yml"
curl -fsSL "$REPO_RAW/docker-compose.yml" -o docker-compose.yml

rand() { head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c "$1"; }

if [ ! -f .env ]; then
  say "Generating .env with random secrets"
  curl -fsSL "$REPO_RAW/.env.example" -o .env
  sed -i.bak "s|^APP_SECRET=.*|APP_SECRET=$(rand 44)|" .env
  sed -i.bak "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(rand 32)|" .env
  rm -f .env.bak
  if [ -n "${DOMAIN:-}" ]; then
    printf '\nDOMAIN=%s\nPUBLIC_URL=https://%s\n' "$DOMAIN" "$DOMAIN" >> .env
  fi
else
  say "Keeping existing .env"
fi

PROFILE=""
if grep -q '^DOMAIN=' .env 2>/dev/null; then PROFILE="--profile https"; fi

say "Pulling images"
docker compose $PROFILE pull
say "Starting AdLedger"
docker compose $PROFILE up -d

URL="http://localhost:$(grep -E '^PORT=' .env | cut -d= -f2 || echo 3000)"
if [ -n "$PROFILE" ]; then URL="https://$(grep '^DOMAIN=' .env | cut -d= -f2)"; fi
say "Done! Open $URL to create your account."
say "Manage it from $(pwd): docker compose logs -f | docker compose pull && docker compose up -d (upgrade)"
