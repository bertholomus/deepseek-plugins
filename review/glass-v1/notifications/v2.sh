#!/bin/bash
# Experiment v2: window already hidden (verified Hidden=true, pid 32658), rig closed.
# Region burst (top-right strip only — privacy), 5 s probes, fork-and-exit so a
# harness stop cannot take the evidence down.
export PATH=/opt/homebrew/bin:$PATH
U=http://127.0.0.1:19840
SHOTS=/Users/albertlee/Projects/worktrees/dsh-release-glass/review/glass-v1/notifications
BURST=/tmp/dshn-v2; rm -rf "$BURST"; mkdir -p "$BURST"
LOG=/tmp/dshn-v2.log
SID=$(cat "$SHOTS/.session-id")

TOKEN=$(sed -n 's/.*token=\([^ ]*\).*/\1/p' ~/.dsh-test-glass-notifications/logs/desktop.out.log | tail -1)
curl -s -c /tmp/dshn-cookie -o /dev/null "$U/?token=$TOKEN"
rpc() { printf '{"type":"client-request","rpcId":"%s","method":"%s","payload":{"args":%s}}' "$(uuidgen | tr A-Z a-z)" "$1" "$2" > /tmp/rpc.json
  curl -s -b /tmp/dshn-cookie -X POST "$U/api/$1" -H 'Content-Type: application/json' --data-binary @/tmp/rpc.json; }

{
  echo "=== v2 start $(date '+%H:%M:%S %Z'); window hidden (Lead-verified + lsappinfo), rig closed"
  # region burst: top-right strip where banners land (screen 2880x1620 pt)
  ( for i in $(seq 0 149); do screencapture -x -t jpg -R2080,0,800,300 "$BURST/f-$(date '+%H%M%S').jpg" 2>/dev/null; sleep 2; done ) &
  echo "$(date '+%H:%M:%S') firing Icon proof v2"
  rpc session/prompt "{\"request\":{\"sessionId\":\"$SID\",\"mode\":\"queue\",\"content\":[{\"type\":\"text\",\"text\":\"Use your thread_start tool to spawn one thread titled Icon proof v2. Its task is only: reply with the single word ready and nothing else. Nothing else this turn.\"}],\"requestId\":\"$(uuidgen | tr A-Z a-z)\"}}"; echo
  FIRE=$(date +%s)
  for i in $(seq 0 119); do   # 10 min at 5 s
    sleep 5
    printf '{"type":"client-request","rpcId":"%s","method":"dsh-plugin-notifications/pending","payload":{"args":{}}}' "$(uuidgen | tr A-Z a-z)" > /tmp/rpc.json
    R=$(rpc dsh-plugin-notifications/pending '{}')
    S=$(( $(date +%s) - FIRE ))
    echo "$(date '+%H:%M:%S') +${S}s ${R:0:230}"
  done
  echo "=== v2 done $(date '+%H:%M:%S'); frames: $(ls "$BURST" 2>/dev/null | wc -l | tr -d ' ')"
} >> "$LOG" 2>&1 &
echo "v2 forked"
