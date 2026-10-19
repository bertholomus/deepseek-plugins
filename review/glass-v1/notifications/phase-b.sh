#!/bin/bash
# Notifications icon proof, phase B — hidden (then minimised) banner shots + vanish-time probe.
# Run from the Lead's session (window state + captures are yours; the RPC firing is one command).
# Each run spawns one more "Icon proof N" thread; its handback queues a notification.
# RESTART FIRST if plugins/notifications changed since the instance booted — the client half
# is served from the checkout and needs a window reload to pick edits up.
export PATH=/opt/homebrew/bin:$PATH
U=http://127.0.0.1:19840
SHOTS=/Users/albertlee/Projects/worktrees/dsh-release-glass/review/glass-v1/notifications
SID=$(cat "$SHOTS/.session-id" 2>/dev/null) || SID=""
[ -z "$SID" ] && { echo "no .session-id from phase A"; exit 1; }
N=$(cat "$SHOTS/.run-count" 2>/dev/null || echo 0); N=$((N+1)); echo "$N" > "$SHOTS/.run-count"

TOKEN=$(sed -n 's/.*token=\([^ ]*\).*/\1/p' ~/.dsh-test-glass-notifications/logs/desktop.out.log | tail -1)
curl -s -c /tmp/dshn-cookie -o /dev/null "$U/?token=$TOKEN"
rpc() { # $1 endpoint, $2 args-json
  printf '{"type":"client-request","rpcId":"%s","method":"%s","payload":{"args":%s}}' "$(uuidgen | tr A-Z a-z)" "$1" "$2" > /tmp/rpc.json
  curl -s -b /tmp/dshn-cookie -X POST "$U/api/$1" -H 'Content-Type: application/json' --data-binary @/tmp/rpc.json
}

echo "== phase $N ($1) $(date '+%H:%M:%S %Z'): spawning Icon proof thread #$N"
rpc session/prompt "{\"request\":{\"sessionId\":\"$SID\",\"mode\":\"queue\",\"content\":[{\"type\":\"text\",\"text\":\"Use your thread_start tool to spawn one thread titled Icon proof $N. Its task is only: reply with the single word ready and nothing else. Nothing else this turn.\"}],\"requestId\":\"$(uuidgen | tr A-Z a-z)\"}}"; echo
echo "== START the ~100 s banner burst NOW (Lead's capture); banner lands ~25-90 s out if it shows at all"
echo "== save as $SHOTS/banner-$1.png (a frame with the banner) and $SHOTS/center-$1.png (Notification Center)"
for i in $(seq 0 42); do
  sleep 10
  printf '{"type":"client-request","rpcId":"%s","method":"dsh-plugin-notifications/pending","payload":{"args":{}}}' "$(uuidgen | tr A-Z a-z)" > /tmp/rpc.json
  R=$(rpc dsh-plugin-notifications/pending '{}')
  echo "$(date '+%H:%M:%S') +$((i*10))s ${R:0:200}"
done
echo "== interpretation: item gone BEFORE +300s = the renderer took it (show path ran silently or banner suppressed;"
echo "   check banner frames + System Settings). Item gone only around/after +300s = never polled (timers"
echo "   suspended) and the 5-min stale prune dropped it. Send t1 the full trace either way."
