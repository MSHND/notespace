#!/bin/sh
set -eu

run() {
  perl -e 'alarm shift; exec @ARGV' 180 "$@"
}

run node --test --test-concurrency=1 \
  tests/p052-additional-device.test.js \
  tests/p074-production-composition.test.js \
  tests/p076-production-browser-boundary.test.js \
  tests/p122-starling-remote-publication.test.js \
  tests/p124-starling-remote-open.test.js \
  tests/p125-starling-remote-edit.test.js

run node --test --test-concurrency=1 \
  tests/p133-starling-fresh-logical-delete-shadow.test.js \
  tests/p134-starling-remote-delete-save.test.js \
  tests/p135-starling-fresh-logical-restore-shadow.test.js \
  tests/p136-starling-remote-restore-save.test.js \
  tests/p139-starling-logical-working-set-compose.test.js

run node --test --test-concurrency=1 tests/p140-starling-remote-working-set-prepare.test.js
run node --test --test-concurrency=1 tests/p141-starling-remote-working-set-save.test.js
run node --test --test-concurrency=1 tests/p146-starling-accepted-document-materialize.test.js

run node --test --test-concurrency=1 \
  tests/p148-starling-owner-working-set-sidecar.test.js \
  tests/p149-starling-owner-working-set-lifecycle.test.js \
  tests/p150-starling-owner-payload-capture.test.js \
  tests/p151-starling-owner-move-reorder-capture.test.js \
  tests/p152-starling-owner-manual-insert-capture.test.js \
  tests/p153-starling-owner-manual-insert-undo-cancel.test.js \
  tests/p154-starling-owner-single-delete-capture.test.js \
  tests/p155-starling-owner-single-delete-undo-cancel.test.js \
  tests/p157-starling-owner-path-import-insert-capture.test.js \
  tests/p158-starling-owner-multi-delete-capture.test.js \
  tests/p159-starling-owner-completed-move-capture.test.js \
  tests/p160-starling-owner-save-preparation.test.js \
  tests/p162-starling-owner-bootstrap.test.js

run node --test --test-concurrency=1 \
  tests/p164-starling-successor-mirror.test.js \
  tests/p168-authority-adoption.test.js \
  tests/p168-starling-reentry.test.js

run npm run check
