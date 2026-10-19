#!/bin/bash
# run2b: fork the probe + burst as detached subshells, then return immediately.
export PATH=/opt/homebrew/bin:$PATH
U=http://127.0.0.1:19840
SHOTS=/Users/albertlee/Projects/worktrees/dsh-release-glass/review/glass-v1/notifications
BURST=/tmp/dshn-burst2; rm -rf "$BURST"; mkdir -p "$BURST"
LOG=/tmp/dshn-run2.log
SID=$(cat "$SHOTS/.session-id")

TOKEN=$(sed -n 's/.*token=\([^ ]*\).*/\1/p' ~/.dsh-test-glass-notifications/logs/desktop.out.log | tail -1)
curl -s -c /tmp/dshn-cookie -o /dev/null "$U/?token=$TOKEN"
rpc() { printf '{"type":"client-request","rpcId":"%s","method":"%s","payload":{"args":%s}}' "$(uuidgen | tr A-Z a-z)" "$1" "$2" > /tmp/rpc.json
  curl -s -b /tmp/dshn-cookie -X POST "$U/api/$1" -H 'Content-Type: application/json' --data-binary @/tmp/rpc.json; }

{
  echo "=== run2 start $(date '+%H:%M:%S %Z')"
  lsappinfo info -only hidden,front "ASN:0x0-0x1028027" 2>&1
  echo "burst start $(date '+%H:%M:%S')"
  ( for i in $(seq 0 119); do screencapture -x "$BURST/f-$(date '+%H%M%S').png" 2>/dev/null; sleep 2; done ) &
  echo "$(date '+%H:%M:%S') firing Icon proof run2"
  rpc session/prompt "{\"request\":{\"sessionId\":\"$SID\",\"mode\":\"queue\",\"content\":[{\"type\":\"text\",\"text\":\"Use your thread_start tool to spawn one thread titled Icon proof run2. Its task is only: reply with the single word ready and nothing else. Nothing else this turn.\"}],\"requestId\":\"$(uuidgen | tr A-Z a-z)\"}}"; echo
  FIRE=$(date +%s)
  for i in $(seq 0 47); do
    sleep 10
    printf '{"type":"client-request","rpcId":"%s","method":"dsh-plugin-notifications/pending","payload":{"args":{}}}' "$(uuidgen | tr A-Z a-z)" > /tmp/rpc.json
    R=$(rpc dsh-plugin-notifications/pending '{}')
    S=$(( $(date +%s) - FIRE ))
    echo "$(date '+%H:%M:%S') +${S}s ${R:0:200}"
  done
  echo "=== run2 done $(date '+%H:%M:%S'); frames: $(ls "$BURST" 2>/dev/null | wc -l | tr -d ' ')"
} >> "$LOG" 2>&1 &
echo "run2 forked; log /tmp/dshn-run2.log"
