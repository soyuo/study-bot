#!/usr/bin/env bash
set -euo pipefail

app_dir="/home/ubuntu/study-bot"
env_backup="${app_dir}/../.study-bot.env"
artifact_backup="/home/ubuntu/study-bot-data/artifacts"

if [ -f "${app_dir}/.env" ]; then
  # Keep the runtime environment outside the directory that the deployer
  # deletes, then move it back after the new release is extracted.
  mv -f "${app_dir}/.env" "${env_backup}"
  chmod 600 "${env_backup}"
fi
mkdir -p "${artifact_backup}"
if [ -d "${app_dir}/data/artifacts" ] && [ ! -L "${app_dir}/data/artifacts" ]; then
  cp -a "${app_dir}/data/artifacts/." "${artifact_backup}/"
fi
