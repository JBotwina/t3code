#!/usr/bin/env bash
#
# Build T2 Code and install it into /Applications, replacing any existing copy.
#
#   scripts/install-t2-code.sh                # build, then install
#   scripts/install-t2-code.sh --no-build     # install the newest existing artifact
#   scripts/install-t2-code.sh --launch       # open the app when done
#   scripts/install-t2-code.sh --arch x64     # default is this machine's arch
#
# Installs from the .zip that the dmg target also produces — no disk image to
# mount and detach. The build is unsigned, so the quarantine flag is cleared
# afterwards or macOS refuses to open it.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="T2 Code"
APP_PATH="/Applications/${APP_NAME}.app"

build=true
launch=false
case "$(uname -m)" in
  arm64) arch="arm64" ;;
  x86_64) arch="x64" ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-build|--skip-build) build=false; shift ;;
    --launch) launch=true; shift ;;
    --arch) arch="${2:?--arch needs a value}"; shift 2 ;;
    -h|--help) sed -n '2,13p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

if [[ "${arch}" != "arm64" && "${arch}" != "x64" ]]; then
  echo "Unsupported --arch: ${arch} (expected arm64 or x64)" >&2
  exit 1
fi

cd "${REPO_ROOT}"

if [[ "${build}" == true ]]; then
  echo "==> Building ${APP_NAME} (${arch})"
  # Local builds are unsigned; without this, electron-builder hunts for a
  # signing identity in the keychain and fails when it finds a partial one.
  CSC_IDENTITY_AUTO_DISCOVERY=false pnpm "dist:desktop:dmg:${arch}"
fi

# shellcheck disable=SC2012  # ls -t is the point: newest artifact wins.
archive="$(ls -t "${REPO_ROOT}/release/T2-Code-"*"-${arch}.zip" 2>/dev/null | head -1 || true)"
if [[ -z "${archive}" ]]; then
  echo "No release/T2-Code-*-${arch}.zip found. Run without --no-build first." >&2
  exit 1
fi
echo "==> Installing from $(basename "${archive}")"

if pgrep -f "${APP_PATH}/Contents/MacOS/" >/dev/null 2>&1; then
  echo "==> Quitting the running ${APP_NAME}"
  osascript -e "quit app \"${APP_NAME}\"" >/dev/null 2>&1 || true
  for _ in $(seq 1 20); do
    pgrep -f "${APP_PATH}/Contents/MacOS/" >/dev/null 2>&1 || break
    sleep 0.5
  done
  # Still alive after 10s: it is wedged, so stop being polite about it.
  pkill -f "${APP_PATH}/Contents/MacOS/" >/dev/null 2>&1 || true
fi

staging="$(mktemp -d "${TMPDIR:-/tmp}/t2-code-install.XXXXXX")"
trap 'rm -rf "${staging}"' EXIT

ditto -xk "${archive}" "${staging}"
staged_app="${staging}/${APP_NAME}.app"
if [[ ! -d "${staged_app}" ]]; then
  echo "Archive did not contain ${APP_NAME}.app" >&2
  exit 1
fi

# Replace only after the new build is known-good on disk, so a failed unzip
# never leaves the machine with no app at all.
rm -rf "${APP_PATH}"
ditto "${staged_app}" "${APP_PATH}"
xattr -dr com.apple.quarantine "${APP_PATH}" 2>/dev/null || true

version="$(/usr/bin/defaults read "${APP_PATH}/Contents/Info" CFBundleShortVersionString 2>/dev/null || echo "unknown")"
echo "==> Installed ${APP_NAME} ${version} to ${APP_PATH}"

if [[ "${launch}" == true ]]; then
  open -a "${APP_PATH}"
fi
