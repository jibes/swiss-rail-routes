#!/usr/bin/env bash
# Installs the APK on a running emulator, launches it and checks that it lives: still running,
# no crash, its window in front, no web errors. Leaves a
# screenshot and logcat in smoke/ either way.
set -euo pipefail

APK="$1"
PKG=ch.brunodev.swissrailroutes
OUT=smoke
mkdir -p "$OUT"

# No permission granted up front: opening the app must not need any.
adb install -r "$APK"
adb logcat -c
adb shell am start -W -n "$PKG/.MainActivity"
# The app logs 'srr:ready' once its lists have loaded (release builds forward the console).
for _ in $(seq 1 30); do
  # Not grep -q: quitting early breaks the pipe, and pipefail would never let the loop end.
  adb logcat -d | grep "srr:ready" > /dev/null && break
  sleep 2
done
sleep 3

adb exec-out screencap -p > "$OUT/screen.png"
adb logcat -d > "$OUT/logcat.txt"
adb shell dumpsys window > "$OUT/window.txt"

fail=0
if ! adb shell pidof "$PKG" >/dev/null; then
  echo "::error::the app is not running after launch"
  fail=1
fi
if grep -E "FATAL EXCEPTION|AndroidRuntime.*$PKG" "$OUT/logcat.txt"; then
  echo "::error::the app crashed"
  fail=1
fi
if ! grep -E "mCurrentFocus=.*$PKG" "$OUT/window.txt"; then
  echo "::error::the app's window is not in front"
  grep -E "mCurrentFocus|mFocusedApp" "$OUT/window.txt" || true
  fail=1
fi
if ! grep -q "srr:ready" "$OUT/logcat.txt"; then
  echo "::error::the web app never said it was ready (no srr:ready in logcat)"
  fail=1
fi
# Console errors of the page (forwarded in release builds, loggingBehavior 'production').
if grep -E " E Capacitor/Console" "$OUT/logcat.txt" | grep -v "Error injecting safe area CSS"; then
  echo "::error::the web app logged errors"
  fail=1
fi
# The WebView must have loaded the bundled page (Chromium logs a renderer crash otherwise).
if grep -E "chromium.*(Renderer process crashed|crashed)" "$OUT/logcat.txt"; then
  echo "::error::the WebView crashed"
  fail=1
fi
exit "$fail"
