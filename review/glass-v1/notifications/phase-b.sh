#!/bin/bash
# Notifications icon proof, phase B — banner shots with the DSH Test window HIDDEN, then MINIMISED.
# Run from the Lead's session AFTER lead-runbook.sh (the thread must exist). t1 verifies via pending().
export PATH=/opt/homebrew/bin:$PATH
U=http://127.0.0.1:19840
SHOTS=/Users/albertlee/Projects/worktrees/dsh-release-glass/review/glass-v1/notifications
mkdir -p "$SHOTS"

TOKEN=$(sed -n 's/.*token=\([^ ]*\).*/\1/p' ~/.dsh-test-glass-notifications/logs/desktop.out.log | tail -1)
curl -s -c /tmp/dshn-cookie -o /dev/null "$U/?token=$TOKEN"
rpc() { curl -s -b /tmp/dshn-cookie -X POST "$U/api/$1" -H 'Content-Type: application/json' \
  -d "{\"type\":\"client-request\",\"rpcId\":\"$(uuidgen | tr A-Z a-z)\",\"method\":\"$1\",\"payload\":$2}"; }

# The coordinating session from the phase-A run, and its first thread id.
SID=$(cat "$SHOTS/.session-id" 2>/dev/null)
[ -z "$SID" ] && { echo "write the phase-A sessionId into $SHOTS/.session-id first"; exit 1; }
TID=$(cat "$SHOTS/.thread-id" 2>/dev/null)
if [ -z "$TID" ]; then
  rpc dsh-plugin-coordinator/describe "{\"target\":\"$SID\"}" > "$SHOTS/.describe.json"
  TID=$(python3 -c "import json;d=json.load(open('$SHOTS/.describe.json'));print(d['result']['value']['threads'][0]['id'])" 2>/dev/null)
fi
echo "== sessionId=$SID thread=$TID"
[ -z "$TID" ] && { echo "no thread id — paste .describe.json back to t1"; exit 1; }
echo "$TID" > "$SHOTS/.thread-id"

phase() { # $1 label: hidden | minimised
  echo "== $1: firing the handback now (continueThread re-runs the thread; its next handback queues a new notification)"
  rpc dsh-plugin-coordinator/continueThread "{\"target\":\"$SID\",\"thread\":\"$TID\"}"; echo
  echo "== $1: your desktop automation captures the banner within ~15-75 s (burst ~100 s), then Notification Center"
  echo "== $1: save as $SHOTS/banner-$1.png and $SHOTS/center-$1.png"
  for i in 1 2 3 4 5 6 8 10 12 14; do
    sleep 5
    echo "pending+$((i*5))s: $(rpc dsh-plugin-notifications/pending '{}' | head -c 220)"
  done
}
phase "${1:-hidden}"
echo "== done: run again with 'minimised' after minimising the window"
