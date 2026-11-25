#!/bin/sh
# Usage: bench/run.sh bench/<script>.ts [args]
set -e
out="bench/data/.build/$(basename "$1" .ts).mjs"
npx esbuild "$1" --bundle --platform=node --format=esm --packages=external --log-level=warning --outfile="$out"
shift
exec node "$out" "$@"
