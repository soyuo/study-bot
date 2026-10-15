#!/usr/bin/env bash
set -euo pipefail

app_dir="/home/ubuntu/study-bot"
env_backup="/home/ubuntu/.study-bot.env"
artifact_backup="/home/ubuntu/study-bot-data/artifacts"

cd "${app_dir}"
if [ -f "${env_backup}" ]; then
  install -m 600 "${env_backup}" .env
fi

npm ci
npm run db:generate
npm run db:migrate:deploy
npm run build

mkdir -p data/artifacts "${artifact_backup}"
cp -a "${artifact_backup}/." data/artifacts/
chmod 700 data/artifacts
if [ -f .env ]; then chmod 600 .env; fi
