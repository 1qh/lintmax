#!/usr/bin/env bash
set -u
mkdir -p node_modules/.bin
cat > node_modules/.bin/q << 'SCRIPT'
#!/usr/bin/env bash
set -u

if [ "$#" -eq 0 ]; then
  printf '%s\n' 'Usage: q <command> [args...]' >&2
  exit 2
fi

out="$("$@" 2>&1)"
status=$?

if [ "$status" -ne 0 ]; then
  printf "%s\n" "$out" >&2
  exit "$status"
fi
SCRIPT
chmod +x node_modules/.bin/q
