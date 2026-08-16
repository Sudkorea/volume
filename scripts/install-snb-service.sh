#!/bin/zsh
set -euo pipefail

app_dir="${1:-/Users/snb/Services/volume-oracle}"
label="com.volume-oracle"
template="$app_dir/deploy/$label.plist.template"
plist="$HOME/Library/LaunchAgents/$label.plist"

if [[ ! -f "$app_dir/package.json" || ! -f "$template" ]]; then
  print -u2 "Volume Oracle files are missing from $app_dir"
  exit 1
fi

mkdir -p "$app_dir/runtime" "$HOME/Library/LaunchAgents"
cd "$app_dir"
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
sed "s|__APP_DIR__|$app_dir|g" "$template" > "$plist"
plutil -lint "$plist"

launchctl bootout "gui/$UID/$label" 2>/dev/null || true
launchctl bootstrap "gui/$UID" "$plist"
launchctl kickstart -k "gui/$UID/$label"

sleep 1
curl --fail --silent --show-error http://127.0.0.1:3000/api/health
print
print "Volume Oracle service installed: $label"
