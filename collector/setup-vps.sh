#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "==> Installing PostgreSQL..."
sudo apt-get update -qq
sudo apt-get install -y postgresql postgresql-contrib

echo "==> Creating DB user and database..."
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='gs_user'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE USER gs_user WITH PASSWORD 'changeme';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='gs_db'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE gs_db OWNER gs_user;"

echo "==> Running schema..."
sudo -u postgres psql -d gs_db -f schema.sql

echo "==> Installing Node.js 20..."
if ! command -v node &>/dev/null || [[ "$(node -e 'process.stdout.write(process.version.split(".")[0].slice(1))')" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "==> Installing PM2..."
sudo npm install -g pm2

echo "==> Installing collector dependencies..."
npm install

echo "==> Setting up .env..."
if [ ! -f .env ]; then
  cp .env.example .env
  echo ""
  echo "  !! Edit .env and set DATABASE_URL + GS_TOKEN, then run:"
  echo "     pm2 start collector.js --name gs-collector"
  echo "     pm2 save"
  echo "     pm2 startup"
else
  echo "  .env already exists — skipping."
  echo ""
  echo "  Start with:"
  echo "     pm2 start collector.js --name gs-collector"
  echo "     pm2 save"
  echo "     pm2 startup"
fi

echo ""
echo "==> Setup complete."
