#!/usr/bin/env bash
set -euo pipefail

cd /home/ubuntu/study-bot
pm2 startOrReload ecosystem.config.cjs --env production
pm2 save
