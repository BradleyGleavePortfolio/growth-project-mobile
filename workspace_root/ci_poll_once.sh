#!/bin/bash
# Single poll iteration - reads/writes state from /home/user/workspace/ci_state.txt
REPO="BradleyGleavePortfolio/growth-project-mobile"
PR=238
EXPECTED_HEAD="207bdc4d9912a6a45c3713a3bf745451c8fd7d11"
REPORT="/home/user/workspace/PR_238_MERGE_REPORT.md"
STATE_FILE="/home/user/workspace/ci_state.txt"

# Read iteration count
if [ -f "$STATE_FILE" ]; then
  ITERATION=$(cat "$STATE_FILE")
else
  ITERATION=0
fi

# Max iterations check
if [ "$ITERATION" -ge 30 ]; then
  echo "TIMEOUT"
  exit 2
fi

ITERATION=$((ITERATION + 1))
echo $ITERATION > "$STATE_FILE"

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
echo "=== Iteration ${ITERATION}/30 at ${TIMESTAMP} ==="

PR_JSON=$(gh pr view ${PR} --repo ${REPO} --json headRefOid,mergeable,mergeStateStatus,statusCheckRollup 2>&1)
echo "Response: ${PR_JSON}"

HEAD=$(echo "$PR_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['headRefOid'])")
if [ "$HEAD" != "$EXPECTED_HEAD" ]; then
  echo "HEAD_CHANGED: expected ${EXPECTED_HEAD}, got ${HEAD}"
  cat > "$REPORT" << REPORT_EOF
# PR #238 CI Watch + Merge Report

## Final State: HEAD_CHANGED

- Expected HEAD: ${EXPECTED_HEAD}
- Actual HEAD: ${HEAD}
- Last check: ${TIMESTAMP}
- Iteration: ${ITERATION}

HEAD changed — someone else pushed to the branch. Task aborted.

NOT_MERGED: HEAD_CHANGED (expected ${EXPECTED_HEAD}, got ${HEAD})
REPORT_EOF
  echo "NOT_MERGED: HEAD_CHANGED"
  exit 3
fi

MERGEABLE=$(echo "$PR_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['mergeable'])")
MERGE_STATE=$(echo "$PR_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['mergeStateStatus'])")

STATUS_EVAL=$(echo "$PR_JSON" | python3 -c "
import sys, json
d = json.load(sys.stdin)
checks = d.get('statusCheckRollup', [])
statuses = [c.get('status','') for c in checks]
conclusions = [c.get('conclusion','') for c in checks]
in_progress = any(s in ('IN_PROGRESS','QUEUED','PENDING','WAITING','REQUESTED') for s in statuses)
failed = any(c in ('FAILURE','CANCELLED','TIMED_OUT','ACTION_REQUIRED') for c in conclusions)
success = bool(conclusions) and all(c == 'SUCCESS' for c in conclusions)
print(f'in_progress={in_progress}')
print(f'failed={failed}')
print(f'success={success}')
for c in checks:
    print(f'  check: {c.get(\"name\")} status={c.get(\"status\")} conclusion={c.get(\"conclusion\")}')
")
echo "$STATUS_EVAL"

IN_PROGRESS=$(echo "$STATUS_EVAL" | grep '^in_progress=' | cut -d= -f2)
FAILED=$(echo "$STATUS_EVAL" | grep '^failed=' | cut -d= -f2)
SUCCESS=$(echo "$STATUS_EVAL" | grep '^success=' | cut -d= -f2)

echo "MERGEABLE=$MERGEABLE MERGE_STATE=$MERGE_STATE"

if [ "$SUCCESS" = "True" ] && [ "$MERGEABLE" = "MERGEABLE" ]; then
  echo "CI SUCCESS — merging..."
  MERGE_OUTPUT=$(gh pr merge ${PR} --repo ${REPO} --squash --admin --delete-branch 2>&1)
  echo "Merge output: ${MERGE_OUTPUT}"
  sleep 5
  MERGE_SHA=$(gh pr view ${PR} --repo ${REPO} --json mergeCommit 2>&1 | python3 -c "import sys,json; d=json.load(sys.stdin); mc=d.get('mergeCommit'); print(mc['oid'] if mc else 'unknown')" 2>/dev/null || echo "unknown")
  echo "Merge SHA: ${MERGE_SHA}"
  cat > "$REPORT" << REPORT_EOF
# PR #238 CI Watch + Merge Report

## Final State: MERGED

- Merge SHA: ${MERGE_SHA}
- HEAD at merge: ${EXPECTED_HEAD}
- Last check: ${TIMESTAMP}
- Iteration: ${ITERATION}
- Merge method: squash
- Branch deleted: yes

## CI Status at Merge

\`\`\`
${STATUS_EVAL}
\`\`\`

## Merge Output

\`\`\`
${MERGE_OUTPUT}
\`\`\`

MERGED: ${MERGE_SHA}
REPORT_EOF
  echo "RESULT:MERGED:${MERGE_SHA}"
  exit 0

elif [ "$FAILED" = "True" ]; then
  echo "CI FAILED — fetching logs..."
  FAILED_JOBS=$(echo "$PR_JSON" | python3 -c "
import sys, json, re
d = json.load(sys.stdin)
checks = d.get('statusCheckRollup', [])
failed = [c for c in checks if c.get('conclusion','') in ('FAILURE','CANCELLED','TIMED_OUT','ACTION_REQUIRED')]
for f in failed:
    print(f'Job: {f.get(\"name\",\"unknown\")}')
    print(f'Conclusion: {f.get(\"conclusion\",\"unknown\")}')
    print(f'Details URL: {f.get(\"detailsUrl\",\"unknown\")}')
    print(f'Workflow: {f.get(\"workflowName\",\"unknown\")}')
    print()
")
  RUN_ID=$(echo "$PR_JSON" | python3 -c "
import sys, json, re
d = json.load(sys.stdin)
checks = d.get('statusCheckRollup', [])
for c in checks:
    if c.get('conclusion','') in ('FAILURE','CANCELLED','TIMED_OUT','ACTION_REQUIRED'):
        url = c.get('detailsUrl','')
        m = re.search(r'/runs/(\d+)', url)
        if m:
            print(m.group(1))
            break
")
  LOGS=""
  if [ -n "$RUN_ID" ]; then
    LOGS=$(gh run view ${RUN_ID} --repo ${REPO} --log-failed 2>&1 | head -200 || true)
  fi
  cat > "$REPORT" << REPORT_EOF
# PR #238 CI Watch + Merge Report

## Final State: CI_FAILED

- HEAD: ${EXPECTED_HEAD}
- Last check: ${TIMESTAMP}
- Iteration: ${ITERATION}

## Failed Jobs

\`\`\`
${FAILED_JOBS}
\`\`\`

## Failed Job Log Excerpts

\`\`\`
${LOGS}
\`\`\`

NOT_MERGED: CI_FAILED
REPORT_EOF
  echo "RESULT:CI_FAILED"
  exit 4

else
  echo "IN_PROGRESS — need to wait"
  echo "RESULT:IN_PROGRESS"
  exit 1
fi
