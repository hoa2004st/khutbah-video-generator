#!/bin/bash
set -e
echo "=== Installing dependencies ==="
npm install
echo "=== Running tests ==="
npm test
echo "=== Type checking ==="
npx tsc --noEmit
echo "=== Environment healthy ==="
