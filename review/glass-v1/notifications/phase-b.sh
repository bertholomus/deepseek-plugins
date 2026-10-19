#!/bin/bash
# Notifications icon proof, phase B — banner shots with the DSH Test window HIDDEN, then MINIMISED.
# Run from the Lead's session. Phase A must have run (review/glass-v1/notifications/.session-id).
# Each run spawns one more "Icon proof" thread; its handback queues a notification that the
# hidden/minimised window's renderer shows (Web Notification of the DSH app = DSH's icon).
export PATH=/opt/homebrew/bin:$PATH
U=http://127.0.0.1:19840
SHOTS=/Users/albertlee/Projects/worktrees/dsh-release-glass/review/glass-v1/notifications
SID=$(cat "$SHOTS/.session-id" 2>/dev/null) || SID=""
[ -z "$SID" ] && { echo "no .session-id from phase A"; exit 1; }
N=$(cat "$SHOTS/.run-count" 2>/dev/null || echo 0); N=$((N+1)); echo "$N" > "$SHOTS/.run-count"

# auth cookie (token is stable for this instance) + one rpc helper (body via file: no quoting traps)
TOKEN=$(sed -n 's/.*token=\([^ ]*\).*/\1/p' ~/.dsh-test-glass-notifications/logs/desktop.out.log | tail -1)
curl -s -c /tmp/dshn-cookie -o /dev/null "$U/?token=$TOKEN"
rpc() { # $1 endpoint, $2 args-json
  printf '{"type":"client-request","rpcId":"%s","method":"%s","payload":{"args":%s}}' "$(uuidgen | tr A-Z a-z)" "$1" "$2" > /tmp/rpc.json
  curl -s -b /tmp/dshn-cookie -X POST "$U/api/$1" -H 'Content-Type: application/json' --data-binary @/tmp/rpc.json
}

echo "== phase $N ($1): spawning Icon proof thread #$N; its handback queues the notification"
rpc session/prompt "{\"request\":{\"sessionId\":\"$SID\",\"mode\":\"queue\",\"content\":[{\"type\":\"text\",\"text\":\"Use your thread_start tool to spawn one thread titled Icon proof $N. Its task is only: reply with the single word ready and nothing else. Nothing else this turn.\"}],\"requestId\":\"$(uuidgen | tr A-Z a-z)\"}}"; echo
echo "== start the ~100 s banner burst NOW (banner lands ~25-60 s out), then Notification Center"
echo "== save as $SHOTS/banner-$1.png and $SHOTS/center-$1.png"
for i in 1 2 3 4 5 6 8 10 12 14 16; do
  sleep 5
  printf '{"type":"client-request","rpcId":"%s","method":"dsh-plugin-notifications/pending","payload":{"args":{}}}' "$(uuidgen | tr A-Z a-z)" > /tmp/rpc.json
  echo "pending+${i}0s: $(rpc dsh-plugin-notifications/pending '{}' | head -c 240)"
done
echo "== done ($1). Check $SHOTS/banner-$1.png shows the DSH whale, then run again with: $0 minimised"
