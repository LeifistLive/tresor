#!/usr/bin/env sh
# Creates .env from .env.example and fills in strong random secrets.
set -eu

cd "$(dirname "$0")/.."

if [ -f .env ]; then
  echo ".env already exists – not overwriting it." >&2
  echo "Delete or rename it first if you really want new secrets (existing data needs the OLD VAULT_MASTER_KEY!)." >&2
  exit 1
fi

random() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 "$1" | tr -d '\n/+=' | cut -c1-"$2"
  else
    LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$2"
  fi
}

POSTGRES_PASSWORD="$(random 36 40)"
VAULT_MASTER_KEY="$(random 72 64)"

sed \
  -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${POSTGRES_PASSWORD}|" \
  -e "s|^VAULT_MASTER_KEY=.*|VAULT_MASTER_KEY=${VAULT_MASTER_KEY}|" \
  .env.example > .env
chmod 600 .env

echo "Created .env with fresh secrets."
echo
echo "IMPORTANT: store a copy of VAULT_MASTER_KEY in your password manager or another safe place."
echo "Without it, the encrypted data in the database cannot be recovered."
