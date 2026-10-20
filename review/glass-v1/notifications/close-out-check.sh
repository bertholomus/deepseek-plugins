#!/bin/bash
# Close-out check: did Albert's toggles land? Read-only; run any time.
# 1) style flags in ncprefs (banner bits should appear after flipping to Banners)
# 2) presented flag in the NC db (presented=1 for a deepseek bundle = a banner showed)
plutil -p ~/Library/Group\ Containers/group.com.apple.usernoted/Library/Preferences/group.com.apple.usernoted.plist > /tmp/ncprefs-now.txt 2>&1
python3 - <<'EOF'
import re
text = open('/tmp/ncprefs-now.txt').read()
for bid in ['ai.deepseek.dsh.desktop','com.deepseek.dsh']:
    i = text.find('"bundle-id" => "' + bid + '"')
    if i < 0: print(bid, 'no entry (defaults: banners on)'); continue
    seg = text[i:i+900]
    f = re.search(r'"flags" => (\d+)', seg)
    flags = int(f.group(1)) if f else 0
    bits = [b for b in range(40) if (flags >> b) & 1]
    print(f'{bid}: flags={flags} hex={flags:#x} bits={bits}')
EOF
cp ~/Library/Group\ Containers/group.com.apple.usernoted/db2/db /tmp/ncdb-check 2>/dev/null
python3 - <<'EOF'
import sqlite3
db = sqlite3.connect('/tmp/ncdb-check')
for app_id, ident in db.execute("SELECT app_id, identifier FROM app WHERE identifier IN ('ai.deepseek.dsh.desktop','com.deepseek.dsh')"):
    rows = db.execute("SELECT presented, COUNT(*), MAX(datetime(delivered_date+978307200,'unixepoch','localtime')) FROM record WHERE app_id=? GROUP BY presented", (app_id,)).fetchall()
    print(ident, rows or 'no records')
EOF