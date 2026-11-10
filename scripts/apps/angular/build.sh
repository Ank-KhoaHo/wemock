#!/usr/bin/env bash
# A26: builds the Angular test app into e2e/fixture/apps/angular. Angular is installed only in
# .check/angular-build (gitignored), never in the repository's own node_modules, so tests and CI
# need no Angular. Rebuild only when scripts/apps/angular changes.
set -euo pipefail
cd "$(dirname "$0")/../../.."
W=.check/angular-build
V=22.2.4
mkdir -p "$W"
rm -rf "$W/src"
cp -r scripts/apps/angular/src "$W/src"
cat > "$W/package.json" <<EOF
{
  "name": "wemock-angular-test-app",
  "private": true,
  "dependencies": {
    "@angular/common": "$V", "@angular/compiler": "$V", "@angular/core": "$V",
    "@angular/platform-browser": "$V", "rxjs": "7.8.2", "tslib": "2.8.1"
  },
  "devDependencies": {
    "@angular/build": "$V", "@angular/cli": "$V", "@angular/compiler-cli": "$V", "typescript": "6.0.2"
  }
}
EOF
cat > "$W/angular.json" <<'EOF'
{
  "$schema": "./node_modules/@angular/cli/lib/config/schema.json",
  "version": 1,
  "newProjectRoot": "projects",
  "projects": {
    "app": {
      "projectType": "application",
      "root": "",
      "sourceRoot": "src",
      "architect": {
        "build": {
          "builder": "@angular/build:application",
          "options": {
            "outputPath": { "base": "dist", "browser": "" },
            "index": "src/index.html",
            "browser": "src/main.ts",
            "tsConfig": "tsconfig.json",
            "baseHref": "/apps/angular/",
            "optimization": true,
            "sourceMap": false,
            "outputHashing": "none"
          }
        }
      }
    }
  },
  "cli": { "analytics": false }
}
EOF
cat > "$W/tsconfig.json" <<'EOF'
{
  "compilerOptions": {
    "strict": true, "target": "ES2022", "module": "ES2022", "moduleResolution": "bundler",
    "lib": ["ES2022", "dom"], "skipLibCheck": true, "isolatedModules": true
  },
  "files": ["src/main.ts"]
}
EOF
cd "$W"
npm install --no-audit --no-fund >/dev/null
NG_CLI_ANALYTICS=false npx ng build
cd - >/dev/null
rm -rf e2e/fixture/apps/angular
mkdir -p e2e/fixture/apps/angular
cp "$W"/dist/*.html "$W"/dist/*.js e2e/fixture/apps/angular/
ls -la e2e/fixture/apps/angular
