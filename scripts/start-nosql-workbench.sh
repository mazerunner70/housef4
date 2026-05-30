#!/usr/bin/env bash
# Launch AWS NoSQL Workbench (DynamoDB visual designer).
#
# Expects NoSQL_Workbench.AppImage on $PATH, or set NOSQL_WORKBENCH_APPIMAGE.
#
# Usage:
#   bash scripts/start-nosql-workbench.sh
#   pnpm run nosql-workbench

set -euo pipefail

APPIMAGE="${NOSQL_WORKBENCH_APPIMAGE:-}"

if [[ -z "$APPIMAGE" ]]; then
  APPIMAGE="$(command -v NoSQL_Workbench.AppImage 2>/dev/null || true)"
fi

if [[ -z "$APPIMAGE" || ! -f "$APPIMAGE" ]]; then
  echo "NoSQL Workbench AppImage not found on PATH (NoSQL_Workbench.AppImage)." >&2
  echo "Download from https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/workbench.settingup.html" >&2
  echo "Or set NOSQL_WORKBENCH_APPIMAGE to the AppImage path." >&2
  exit 1
fi

exec "$APPIMAGE" --no-sandbox "$@"
