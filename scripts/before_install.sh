#!/usr/bin/env bash
set -euo pipefail

app_dir="/home/ubuntu/study-bot"
env_backup="/home/ubuntu/.study-bot.env"
artifact_backup="/home/ubuntu/study-bot-data/artifacts"

if [ -f "${app_dir}/.env" ]; then
  install -m 600 "${app_dir}/.env" "${env_backup}"
fi
mkdir -p "${artifact_backup}"
if [ -d "${app_dir}/data/artifacts" ] && [ ! -L "${app_dir}/data/artifacts" ]; then
  cp -a "${app_dir}/data/artifacts/." "${artifact_backup}/"
fi
