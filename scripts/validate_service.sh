#!/usr/bin/env bash
set -euo pipefail

pm2 describe study-bot >/dev/null
test "$(pm2 pid study-bot)" != "0"

node - <<'NODE'
const { execFileSync } = require("node:child_process");
const apps = JSON.parse(execFileSync("pm2", ["jlist"], { encoding: "utf8" }));
const app = apps.find((item) => item.name === "study-bot");
if (!app || app.pm2_env.status !== "online") process.exit(1);
NODE
