#!/bin/zsh
set -euo pipefail

app_dir="${1:-/Users/snb/Services/volume-oracle}"
label="com.volume-oracle"
template="$app_dir/deploy/$label.plist.template"
plist="$HOME/Library/LaunchAgents/$label.plist"
node_bin="/Users/snb/.local/bin/node"

if [[ ! -f "$app_dir/package.json" || ! -f "$template" ]]; then
  print -u2 "Volume Oracle files are missing from $app_dir"
  exit 1
fi

"$node_bin" -e '
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 23)) {
    console.error(`Node ${process.versions.node} is too old; 22.23.0 or newer is required`);
    process.exit(1);
  }
'

mkdir -p "$app_dir/runtime" "$HOME/Library/LaunchAgents"
chmod 700 "$app_dir/runtime"
for runtime_file in "$app_dir"/runtime/*(.N); do
  chmod 600 "$runtime_file"
done
if [[ -f "$app_dir/.env" ]]; then
  chmod 600 "$app_dir/.env"
fi
cd "$app_dir"
/Users/snb/.local/bin/npm ci --omit=dev --ignore-scripts --no-audit --no-fund
sed "s|__APP_DIR__|$app_dir|g" "$template" > "$plist"
chmod 600 "$plist"
plutil -lint "$plist"

launchctl bootout "gui/$UID/$label" 2>/dev/null || true
launchctl bootstrap "gui/$UID" "$plist"
launchctl kickstart -k "gui/$UID/$label"

health_response=""
for attempt in {1..20}; do
  if health_response="$(curl --fail --silent --max-time 2 http://127.0.0.1:3000/api/health 2>/dev/null)"; then
    break
  fi
  sleep 0.5
done
if [[ -z "$health_response" ]]; then
  print -u2 "Volume Oracle did not become healthy after launch"
  launchctl print "gui/$UID/$label" >&2 || true
  exit 1
fi
print -r -- "$health_response"
print
print "Volume Oracle service installed: $label"
