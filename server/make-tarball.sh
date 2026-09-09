#!/bin/bash
# Full-snapshot tarball for deploying to the games server. No diffs.
# config.json and data/ are excluded so the server keeps its own.
set -e
cd "$(dirname "$0")"
node sync-shared.mjs
OUT=volt-server.tgz
tar czf "$OUT" \
  --exclude=node_modules \
  --exclude=config.json \
  --exclude=data \
  --exclude='*.tgz' \
  --exclude=_t \
  --exclude=test-flow.sh \
  --transform 's,^,volt-server/,' \
  server.mjs package.json config.example.json sync-shared.mjs make-tarball.sh \
  lib shared public assets deploy README.md
echo "wrote $OUT ($(du -h "$OUT" | cut -f1))"
