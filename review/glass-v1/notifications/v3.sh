#!/bin/bash
# v3: window hidden (verified via poll-state + lsappinfo), no other clients.
# Fire a handback; the moment the item appears in pending, start the banner-region
# burst; log every new poll-state/show-error string from the instance's leveldb.
export PATH=/opt/homebrew/bin:$PATH
U=http://127.0.0.1:19840
SHOTS=/Users/albertlee/Projects/worktrees/dsh-release-glass/review/glass-v1/notifications
BURST=/tmp/dshn-v3; rm -rf "$BURST"; mkdir -p "$BURST"
LOG=/tmp/dshn-v3.log
LD="/Users/albertlee/.dsh-test-glass-notifications-electron/Local Storage/leveldb"
SID=$(cat "$SHOTS/.session-id")

TOKEN=$(sed -n 's/.*token=\([^ ]*\).*/\1/p' ~/.dsh-test-glass-notifications/logs/desktop.out.log | tail -1)
curl -s -c /tmp/dshn-cookie -o /dev/null "$U/?token=$TOKEN"
rpc() { printf '{"type":"client-request","rpcId":"%s","method":"%s","payload":{"args":%s}}' "$(uuidgen | tr A-Z a-z)" "$1" "$2" > /tmp/rpc.json
  curl -s -b /tmp/dshn-cookie -X POST "$U/api/$1" -H 'Content-Type: application/json' --data-binary @/tmp/rpc.json; }
leveldb_scan() { python3 - "$LD" <<'EOF'
import glob, re, sys
out = []
for f in glob.glob(sys.argv[1] + '/*'):
    try: data = open(f,'rb').read()
    except Exception: continue
    for m in re.finditer(rb'\{"at":"2026[^{}]*\}', data):
        out.append(m.group(0).decode('utf-8','replace'))
    for needle in (b'did not display', b'denied in this window'):
        if needle in data: out.append('ERRSTRING:' + needle.decode())
print('|'.join(out[-3:]) if out else '-')
EOF
}

{
  echo "=== v3 start $(date '+%H:%M:%S %Z')"
  echo "before: $(leveldb_scan)"
  echo "$(date '+%H:%M:%S') firing Icon proof v3"
  rpc session/prompt "{\"request\":{\"sessionId\":\"$SID\",\"mode\":\"queue\",\"content\":[{\"type\":\"text\",\"text\":\"Use your thread_start tool to spawn one thread titled Icon proof v3. Its task is only: reply with the single word ready and nothing else. Nothing else this turn.\"}],\"requestId\":\"$(uuidgen | tr A-Z a-z)\"}}"; echo
  FIRE=$(date +%s); BURSTPID=""
  for i in $(seq 0 149); do   # 12.5 min at 5 s
    sleep 5
    printf '{"type":"client-request","rpcId":"%s","method":"dsh-plugin-notifications/pending","payload":{"args":{}}}' "$(uuidgen | tr A-Z a-z)" > /tmp/rpc.json
    R=$(rpc dsh-plugin-notifications/pending '{}')
    S=$(( $(date +%s) - FIRE ))
    echo "$(date '+%H:%M:%S') +${S}s ${R:0:200} | ldb: $(leveldb_scan)"
    case "$R" in *'"items":[{"id"'*)
      if [ -z "$BURSTPID" ]; then
        echo "$(date '+%H:%M:%S') ITEM VISIBLE — burst starts (2 s region frames, 100 s)"
        ( for j in $(seq 0 49); do screencapture -x -t jpg -R2080,0,800,300 "$BURST/f-$(date '+%H%M%S').jpg" 2>/dev/null; sleep 2; done ) &
        BURSTPID=$!
      fi ;;
    esac
  done
  wait $BURSTPID 2>/dev/null
  echo "=== v3 done $(date '+%H:%M:%S'); frames: $(ls "$BURST" 2>/dev/null | wc -l | tr -d ' ')"
} >> "$LOG" 2>&1 &
echo "v3 forked"
