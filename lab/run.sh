#!/usr/bin/env bash
# The wemock lab: a small real ASP.NET Core shop, in Docker, for trying every kind of mock.
#   bash lab/run.sh serve   start it on http://localhost:5199 and leave it running (Ctrl+C stops it)
#   bash lab/run.sh test    start it, run lab/features.spec.ts and lab/perf.spec.ts, then stop it
#   bash lab/run.sh perf    start it, run lab/perf.spec.ts only
# Needs Docker, so it is not part of CI. The test modes need `npm run build` first.
set -euo pipefail
cd "$(dirname "$0")/.."
MODE="${1:-serve}"
NAME=wemock-lab
PORT="${LAB_PORT:-5199}"

# The page's client libraries come from node_modules; they are not committed.
mkdir -p lab/server/wwwroot/vendor
cp node_modules/@microsoft/signalr/dist/browser/signalr.min.js lab/server/wwwroot/vendor/
cp node_modules/axios/dist/axios.min.js lab/server/wwwroot/vendor/

docker rm -f "$NAME" >/dev/null 2>&1 || true
# The SDK image builds a copy of the source inside the container (the mount is read-only), so
# nothing is installed on the host and no bin/ or obj/ lands in the repository.
MSYS_NO_PATHCONV=1 docker run -d --name "$NAME" -p "127.0.0.1:${PORT}:8080" \
  -v "$(pwd -W 2>/dev/null || pwd)/lab/server:/src:ro" \
  -e ASPNETCORE_URLS=http://+:8080 -e DOTNET_CLI_TELEMETRY_OPTOUT=1 -e DOTNET_NOLOGO=1 \
  mcr.microsoft.com/dotnet/sdk:10.0 sh -c 'cp -r /src /app && rm -rf /app/bin /app/obj && cd /app && dotnet run -c Release' >/dev/null
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT

echo "Starting the lab (the first start builds it, about a minute) ..."
for i in $(seq 1 150); do
  if curl -fs "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -fs "http://127.0.0.1:${PORT}/health" >/dev/null || { docker logs "$NAME" | tail -40; exit 1; }

export LAB_URL="http://localhost:${PORT}"
case "$MODE" in
  serve)
    echo "The lab is at $LAB_URL. Press Ctrl+C to stop it."
    docker logs -f "$NAME" >/dev/null 2>&1 || true
    ;;
  test) npx playwright test --config lab/lab.config.ts ;;
  perf) npx playwright test --config lab/lab.config.ts lab/perf.spec.ts ;;
  *) echo "Unknown mode: $MODE (serve, test or perf)"; exit 2 ;;
esac
