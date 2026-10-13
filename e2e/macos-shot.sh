#!/bin/bash
# Mount the .dmg, copy the app, open it, try to type a get (System Events needs an
# accessibility permission the runner may not grant: then only the first shot shows), and
# take screenshots: e2e/shots/macos-1-open.png, macos-2-get.png. For CI.
set -u
dmg="$1"
mkdir -p e2e/shots
mnt=$(hdiutil attach "$dmg" -nobrowse | awk -F'\t' '/\/Volumes\//{print $NF}' | tail -1)
cp -R "$mnt"/*.app /Applications/
app=$(ls -d /Applications/Modkeel*.app | head -1)
echo "app: $app"; ls "$app/Contents/MacOS"
xattr -cr "$app"                       # unsigned build: drop the quarantine flag
open "$app"
sleep 20
screencapture -x e2e/shots/macos-1-open.png && echo "shot: macos-1-open.png"
# three tabs: the "Get a mod" and "Move a pack" tabs, then the Mod field
osascript -e 'tell application "System Events" to keystroke tab' \
          -e 'tell application "System Events" to keystroke tab' \
          -e 'tell application "System Events" to keystroke tab' \
          -e 'tell application "System Events" to keystroke "Sodium"' \
          -e 'tell application "System Events" to keystroke tab' \
          -e 'tell application "System Events" to keystroke "1.21.10"' \
          -e 'tell application "System Events" to key code 36' \
  || echo "typing not allowed on this runner (accessibility permission)"
sleep 45
screencapture -x e2e/shots/macos-2-get.png && echo "shot: macos-2-get.png"
find "$HOME/Downloads/Modkeel" -name "*.jar" 2>/dev/null | sed 's/^/jar: /'
echo "engine processes: $(pgrep -f modkeel-engine | wc -l)"
pkill -f "$app/Contents/MacOS" || true
