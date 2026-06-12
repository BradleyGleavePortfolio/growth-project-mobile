#!/usr/bin/env python3
"""
Health check script for CI runner pool.
Reads JSON run list from stdin, takes current epoch timestamp as argv[1].
Exits 0 (recovered) or 1 (still in outage).
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

now = float(sys.argv[1])
data = sys.stdin.read().strip()
if not data:
    print("NOT_RECOVERED:empty-input")
    sys.exit(1)

try:
    runs = json.loads(data)
except json.JSONDecodeError as e:
    print(f"NOT_RECOVERED:json-error:{e}", file=sys.stderr)
    sys.exit(1)

for r in runs:
    status = r.get('status', '')
    conclusion = r.get('conclusion', '')
    started_ts = ts(r.get('startedAt', ''))
    updated_ts = ts(r.get('updatedAt', ''))
    run_id = r.get('databaseId', '')

    # Recovery signal 1: in_progress run that has been running > 30s
    if status == 'in_progress' and started_ts > 0:
        elapsed = now - started_ts
        print(f"  in_progress run {run_id}: elapsed={elapsed:.0f}s", file=sys.stderr)
        if elapsed > 30:
            print(f"RECOVERED:in_progress:{run_id}:{elapsed:.0f}")
            sys.exit(0)

    # Recovery signal 2: recent successful run that ran > 60s
    if conclusion == 'success' and started_ts > 0 and updated_ts > 0:
        duration = updated_ts - started_ts
        age = now - updated_ts
        print(f"  success run {run_id}: duration={duration:.0f}s age={age:.0f}s", file=sys.stderr)
        if duration > 60 and age < 1800:
            print(f"RECOVERED:success:{run_id}:{duration:.0f}")
            sys.exit(0)

print("NOT_RECOVERED")
sys.exit(1)
