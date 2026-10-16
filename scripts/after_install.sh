#!/usr/bin/env bash
set -euo pipefail

app_dir="/home/ubuntu/study-bot"
env_backup="${app_dir}/../.study-bot.env"
artifact_backup="/home/ubuntu/study-bot-data/artifacts"

cd "${app_dir}"
if [ -f "${env_backup}" ]; then
  # Moving removes the temporary parent-level backup after restoration.
  mv -f "${env_backup}" .env
  chmod 600 .env
fi

if [ ! -s .env ]; then
  echo "Missing ${app_dir}/.env after deployment" >&2
  exit 1
fi

if ! grep -qE '^DATABASE_URL[[:space:]]*=' .env; then
  echo "DATABASE_URL is missing from ${app_dir}/.env" >&2
  exit 1
fi

if ! command -v unzip >/dev/null 2>&1; then
  echo "unzip is not installed; installing it for ZIP submission grading"
  if command -v apt-get >/dev/null 2>&1; then
    if [ "$(id -u)" -eq 0 ]; then
      apt-get update
      apt-get install -y unzip
    elif command -v sudo >/dev/null 2>&1; then
      sudo -n apt-get update
      sudo -n apt-get install -y unzip
    else
      echo "Cannot install unzip: apt-get requires root or passwordless sudo" >&2
      exit 1
    fi
  elif command -v apk >/dev/null 2>&1; then
    if [ "$(id -u)" -eq 0 ]; then
      apk add --no-cache unzip
    elif command -v sudo >/dev/null 2>&1; then
      sudo -n apk add --no-cache unzip
    else
      echo "Cannot install unzip: apk requires root or passwordless sudo" >&2
      exit 1
    fi
  else
    echo "Cannot install unzip: no supported package manager found" >&2
    exit 1
  fi
fi

npm ci
npm run db:generate
npm run db:migrate:deploy
npm run build

mkdir -p data/artifacts "${artifact_backup}"
cp -a "${artifact_backup}/." data/artifacts/
chmod 700 data/artifacts
if [ -f .env ]; then chmod 600 .env; fi
