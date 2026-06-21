#!/bin/bash
# Wrapper: strip --timestamp so codesign doesn't hang on Apple server
# with self-signed certs. Replace bare --timestamp with --timestamp=none.
REAL=/usr/bin/codesign
ARGS=()
for arg in "$@"; do
  if [ "$arg" = "--timestamp" ]; then
    ARGS+=("--timestamp=none")
  else
    ARGS+=("$arg")
  fi
done
exec "$REAL" "${ARGS[@]}"
