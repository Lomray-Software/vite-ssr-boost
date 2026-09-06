#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'HELP'
Usage: verify.sh [--dry-run] [project-directory]
Run installed SSR Boost doctor, build, app size budget, smoke, then restore SSR output.
Requires Node, npm, installed project dependencies, build and smoke scripts, and
size:check (or test:size). Does not install packages or run browser tests.
--dry-run  Print the command plan without reading or changing the project.
--help     Print this help without running any commands.
Run the application's lint/types, test:ssr and test:browser separately.
HELP
}

dry=false
project=.
project_set=false
for arg in "$@"; do
  case "$arg" in
    --help|-h) usage; exit 0 ;;
    --dry-run) dry=true ;;
    -*) printf 'Unknown option: %s\n' "$arg" >&2; exit 2 ;;
    *)
      if "$project_set"; then usage >&2; exit 2; fi
      project="$arg"
      project_set=true
      ;;
  esac
done

if "$dry"; then
  printf 'Project: %s\n' "$project"
  cat <<'PLAN'
./node_modules/.bin/ssr-boost doctor --json
npm run build -- --throw-warnings
npm run size:check (or npm run test:size)
npm run smoke
npm run build -- --throw-warnings
PLAN
  exit 0
fi

cd -- "$project"
if [[ ! -x node_modules/.bin/ssr-boost ]]; then
  printf '%s\n' 'Missing local ssr-boost. Install the application dependencies first.' >&2
  exit 1
fi
size_script=$(node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
const { scripts = {} } = JSON.parse(readFileSync('package.json', 'utf8'));
for (const name of ['build', 'smoke']) {
  if (!scripts[name]) throw new Error(`Missing ${name} script; follow references/verification.md.`);
}
const size = ['size:check', 'test:size'].find((name) => scripts[name]);
if (!size) throw new Error('Missing enforced size:check or test:size script.');
console.log(size);
NODE
)
./node_modules/.bin/ssr-boost doctor --json
npm run build -- --throw-warnings
npm run "$size_script"
npm run smoke
# Template smoke builds SPA last; leave an SSR build for browser tests/deployment.
npm run build -- --throw-warnings
printf '%s\n' 'Doctor, build, size and smoke passed; SSR output restored. Review doctor warnings.'
