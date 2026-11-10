#!/usr/bin/env bash
# A27: check wemock against a real ASP.NET Core SignalR hub. Needs Docker; not part of CI.
# Usage: npm run build && bash scripts/real-hub/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
NAME=wemock-real-hub
PORT="${HUB_PORT:-5099}"

docker rm -f "$NAME" >/dev/null 2>&1 || true
# The SDK image runs the hub straight from source; nothing is installed on the host.
MSYS_NO_PATHCONV=1 docker run -d --name "$NAME" -p "127.0.0.1:${PORT}:8080" \
  -v "$(pwd -W 2>/dev/null || pwd)/scripts/real-hub/hub:/src" -w /src \
  -e ASPNETCORE_URLS=http://+:8080 -e DOTNET_CLI_TELEMETRY_OPTOUT=1 \
  mcr.microsoft.com/dotnet/sdk:10.0 dotnet run -c Release >/dev/null
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT

for i in $(seq 1 120); do
  if curl -fs "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -fs "http://127.0.0.1:${PORT}/health" >/dev/null || { docker logs "$NAME" | tail -30; exit 1; }

HUB_URL="http://127.0.0.1:${PORT}/hubs/shop" HUB_NAME="$NAME" npx playwright test --config scripts/real-hub/realhub.config.ts
