#!/bin/bash
# Decisive run: visible-but-unfocused DSH Test window. Banner burst in /tmp (privacy),
# trigger via gateway, 10 s vanish-time probes. Only banner crops go to the repo.
export PATH=/opt/homebrew/bin:$PATH
U=http://127.0.0.1:19840
W=/Users/albertlee/Projects/worktrees/dsh-release-glass
SHOTS=$W/review/glass-v1/notifications
BURST=/tmp/dshn-burst; rm -rf "$BURST"; mkdir -p "$BURST"
SID=$(cat "$SHOTS/.session-id")

TOKEN=$(sed -n 's/.*token=\([^ ]*\).*/\1/p' ~/.dsh-test-glass-notifications/logs/desktop.out.log | tail -1)
curl -s -c /tmp/dshn-cookie -o /dev/null "$U/?token=$TOKEN"
rpc() { printf '{"type":"client-request","rpcId":"%s","method":"%s","payload":{"args":%s}}' "$(uuidgen | tr A-Z a-z)" "$1" "$2" > /tmp/rpc.json
  curl -s -b /tmp/dshn-cookie -X POST "$U/api/$1" -H 'Content-Type: application/json' --data-binary @/tmp/rpc.json; }

echo "$(date '+%H:%M:%S') burst start (2 s interval, 150 s)"
( for i in $(seq 0 74); do screencapture -x "$BURST/f-$(date '+%H%M%S').png" 2>/dev/null; sleep 2; done ) &
BURSTPID=$!

sleep 3
echo "$(date '+%H:%M:%S') firing Icon proof run1"
rpc session/prompt "{\"request\":{\"sessionId\":\"$SID\",\"mode\":\"queue\",\"content\":[{\"type\":\"text\",\"text\":\"Use your thread_start tool to spawn one thread titled Icon proof run1. Its task is only: reply with the single word ready and nothing else. Nothing else this turn.\"}],\"requestId\":\"$(uuidgen | tr A-Z a-z)\"}}"; echo

for i in $(seq 0 44); do
  sleep 10
  printf '{"type":"client-request","rpcId":"%s","method":"dsh-plugin-notifications/pending","payload":{"args":{}}}' "$(uuidgen | tr A-Z a-z)" > /tmp/rpc.json
  R=$(rpc dsh-plugin-notifications/pending '{}')
  echo "$(date '+%H:%M:%S') +$((i*10))s ${R:0:220}"
done
wait $BURSTPID 2>/dev/null
echo "$(date '+%H:%M:%S') burst frames: $(ls "$BURST" | wc -l | tr -d ' ')"
