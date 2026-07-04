#!/usr/bin/env bash
#
# package-linux.sh — Build deb from linux-unpacked
#
# Usage:
#   ./scripts/package-linux.sh deb
#
# Prerequisites:
#   - release/linux-unpacked already built (electron-builder --linux --x64)
#     Note: AppImage is now built directly by electron-builder (built-in Fuse2).
#   - fakeroot + dpkg-deb (for deb)
#
set -euo pipefail

RELEASE_DIR="$(cd "$(dirname "$0")/../release" && pwd)"
UNPACKED_DIR="$RELEASE_DIR/linux-unpacked"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Read version from package.json
VERSION=$(node -e "console.log(require('$PROJECT_DIR/package.json').version)")
APP_NAME="deskwand"
ARCH="amd64"

# ──────────────────────────────────────────────
# deb
# ──────────────────────────────────────────────
build_deb() {
  local STAGING="/tmp/deskwand-deb-$$"
  local OUTPUT="$RELEASE_DIR/DeskWand-${VERSION}-linux-${ARCH}.deb"
  local INSTALL_DIR="/opt/${APP_NAME}"

  echo "📦 Building deb..."
  echo "   Output: $OUTPUT"

  rm -rf "$STAGING"
  mkdir -p "$STAGING${INSTALL_DIR}"
  mkdir -p "$STAGING/DEBIAN"

  # Copy all files from linux-unpacked to staging
  cp -a "$UNPACKED_DIR"/* "$STAGING${INSTALL_DIR}/"

  # ── Desktop integration ──
  # .desktop file → application menu entry
  mkdir -p "$STAGING/usr/share/applications"
  cat > "$STAGING/usr/share/applications/${APP_NAME}.desktop" << DESKTOPEOF
[Desktop Entry]
Name=DeskWand
Comment=AI Agent Desktop App
Exec=${INSTALL_DIR}/deskwand
Icon=${APP_NAME}
Type=Application
Categories=Development;
Terminal=false
DESKTOPEOF

  # Icon: install to hicolor theme so DEs/WMs can find it
  local ICON_SIZE="256x256"
  mkdir -p "$STAGING/usr/share/icons/hicolor/${ICON_SIZE}/apps"
  local SRC_ICON="$PROJECT_DIR/resources/icon.png"
  if [ -f "$SRC_ICON" ]; then
    cp "$SRC_ICON" "$STAGING/usr/share/icons/hicolor/${ICON_SIZE}/apps/${APP_NAME}.png"
  else
    echo "⚠️  icon not found at $SRC_ICON — deb will have no application icon"
  fi

  # ── DEBIAN/control ──
  cat > "$STAGING/DEBIAN/control" << EOF
Package: ${APP_NAME}
Version: ${VERSION}
Section: utils
Priority: optional
Architecture: ${ARCH}
Installed-Size: $(du -sk "$UNPACKED_DIR" | cut -f1)
Maintainer: DeskWand Team <hello@deskwand.com>
Description: AI Agent Desktop App
 Open-source AI agent desktop app for Linux —
 one-click install Claude Code, MCP tools, and Skills
 with sandbox isolation and multi-model support.
EOF

  # ── DEBIAN/postinst (runs as root during dpkg -i) ──
  # Set SUID sandbox permissions — the standard Electron approach.
  cat > "$STAGING/DEBIAN/postinst" << 'SCRIPT'
#!/bin/sh
set -e
SANDBOX="/opt/deskwand/chrome-sandbox"
if [ -f "$SANDBOX" ]; then
  chown root:root "$SANDBOX"
  chmod 4755 "$SANDBOX"
fi
# Register desktop entry & icon cache
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database /usr/share/applications || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache /usr/share/icons/hicolor || true
fi
SCRIPT
  chmod 0755 "$STAGING/DEBIAN/postinst"

  # ── DEBIAN/postrm ──
  cat > "$STAGING/DEBIAN/postrm" << 'SCRIPT'
#!/bin/sh
set -e
if [ "$1" = "remove" ] || [ "$1" = "purge" ]; then
  if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database /usr/share/applications || true
  fi
fi
SCRIPT
  chmod 0755 "$STAGING/DEBIAN/postrm"

  # ── Build deb with fakeroot ──
  # fakeroot is required so that chrome-sandbox ownership
  # (root:root with SUID) is correctly recorded in the deb archive.
  # The postinst script handles this at install time, but we also
  # set it at build time for consistency.
  fakeroot -- env STAGING="$STAGING" INSTALL_DIR="$INSTALL_DIR" OUTPUT="$OUTPUT" sh -c '
    chown root:root "$STAGING$INSTALL_DIR/chrome-sandbox" 2>/dev/null || true
    chmod 4755 "$STAGING$INSTALL_DIR/chrome-sandbox" 2>/dev/null || true
    dpkg-deb --build "$STAGING" "$OUTPUT"
  '

  rm -rf "$STAGING"
  echo "✅ deb built: $OUTPUT"
}

# ──────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────

if [ ! -d "$UNPACKED_DIR" ]; then
  echo "❌ linux-unpacked not found at $UNPACKED_DIR"
  echo "   Run 'electron-builder --linux --x64' first."
  exit 1
fi

if [ $# -eq 0 ]; then
  echo "Usage: $0 deb"
  exit 1
fi

mkdir -p "$RELEASE_DIR"

for target in "$@"; do
  case "$target" in
    deb)
      if ! command -v fakeroot &>/dev/null; then
        echo "❌ fakeroot not found (required for SUID chrome-sandbox)"
        exit 1
      fi
      build_deb
      ;;
    *)
      echo "❌ Unknown target: $target (use deb)"
      exit 1
      ;;
  esac
done
