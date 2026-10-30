#!/usr/bin/env bash
# Usage: log.sh <logfile> <kind> <unit> <what> <why> <evidence> <result>
set -euo pipefail
if [ "$#" -ne 7 ]; then
  echo "usage: $0 <logfile> <kind> <unit> <what> <why> <evidence> <result>" >&2
  exit 2
fi
log="$1"; shift
mkdir -p "$(dirname "$log")"
if [ ! -s "$log" ]; then
  printf 'ts\tkind\tunit\twhat\twhy\tevidence\tresult\n' > "$log"
fi
clean() {
  local v
  v="$(printf '%s' "$1" | tr '\t\r\n' '   ')"
  case "$v" in
    [=+@-]*) v="'$v" ;;
  esac
  printf '%s' "$v"
}
ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
  "$ts" "$(clean "$1")" "$(clean "$2")" "$(clean "$3")" "$(clean "$4")" "$(clean "$5")" "$(clean "$6")" >> "$log"
