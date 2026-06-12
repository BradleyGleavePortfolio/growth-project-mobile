#!/usr/bin/env python3
"""
Find the most recent run for a branch that was created at or after a given timestamp.
Reads JSON run list from stdin, takes after_ts (epoch) as argv[1].
Prints run ID and exits 0, or exits 1 if not found.
"""
import sys, json
from datetime import datetime, timezone

def ts(s):
    if not s or s in ('None', 'null', ''):
        return 0
    try:
        return datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp()
    except Exception:
        return 0

after = float(sys.argv[1])
data = sys.stdin.read().strip()
if not data:
    sys.exit(1)

try:
    runs = json.loads(data)
except json.JSONDecodeError:
    sys.exit(1)

for r in runs:
    t = ts(r.get('createdAt', ''))
    if t >= after - 30:  # 30s tolerance for clock skew
        print(r['databaseId'])
        sys.exit(0)

sys.exit(1)
