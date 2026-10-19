#!/bin/bash
# Notifications icon proof — runbook for the Lead's session (glass-notifications instance).
# Every step prints what to send back to thread t1. Safe to re-run; nothing touches the live DSH.
export PATH=/opt/homebrew/bin:$PATH
NAME=glass-notifications
U=http://127.0.0.1:19840
SHOTS=/Users/albertlee/Projects/worktrees/dsh-release-glass/review/glass-v1/notifications
mkdir -p "$SHOTS"

say() { echo; echo "== $*"; }

# ── 1) instance up + doctor + fingerprint ────────────────────────────────
say "1. up (skips itself if already running)"
~/.local/bin/dsh-test --name $NAME up || exit 1
say "1b. doctor (expect: Import check 0 error(s), Isolation check: ok)"
~/.local/bin/dsh-test --name $NAME doctor
say "1c. fingerprint (log this line to review/RELEASE-PROGRESS.md)"
~/.local/bin/dsh-test fingerprint

# ── 2) auth cookie + gateway helper ─────────────────────────────────────
say "2. sign-in cookie (token is stable across restarts for this instance)"
TOKEN=$(sed -n 's/.*token=\([^ ]*\).*/\1/p' ~/.dsh-test-glass-notifications/logs/desktop.out.log | tail -1)
curl -s -c /tmp/dshn-cookie -o /dev/null "$U/?token=$TOKEN"
rpc() { curl -s -b /tmp/dshn-cookie -X POST "$U/api/$1" -H 'Content-Type: application/json' \
  -d "{\"type\":\"client-request\",\"rpcId\":\"$(uuidgen | tr A-Z a-z)\",\"method\":\"$1\",\"payload\":$2}"; echo; }

say "2b. notifications pending — expect HTTP 200 {ok:true,value:{desktop:false,items:[]}}"
rpc dsh-plugin-notifications/pending '{}'

say "2c. coordinator serving? — expect {ok:true,value:{projects:[...]}} (404 means the restart in step 1 did not happen)"
rpc dsh-plugin-coordinator/list '{}'

# ── 3) scratch session + coordination + thread (the real handback) ──────
say "3. create the scratch session (cwd is /tmp on purpose; nothing is written there)"
CREATE=$(rpc session/create '{"cwd":"/tmp"}')
echo "$CREATE"
SID=$(echo "$CREATE" | sed -n 's/.*"sessionId":"\([^"]*\)".*/\1/p' | head -1)
say "3b. sessionId = $SID  (send this back if empty)"
[ -z "$SID" ] && exit 1
echo "$SID" > "$SHOTS/.session-id"

say "4. turn coordinating on for it"
rpc dsh-plugin-coordinator/coordinate "{\"target\":\"$SID\",\"on\":true}"

say "5. ask the coordinating chat to spawn one thread (its handback is the queue event)"
rpc session/prompt "{\"sessionId\":\"$SID\",\"content\":[{\"type\":\"text\",\"text\":\"Use your thread_start tool to spawn one thread titled Icon proof. Its task is only: reply with the single word ready and nothing else. Nothing else this turn.\"}],\"requestId\":\"$(uuidgen | tr A-Z a-z)\"}"

say "6. watch the queue: run this a few times over ~3 minutes; an item appearing and then vanishing means the hidden window showed it"
rpc dsh-plugin-notifications/pending '{}'
