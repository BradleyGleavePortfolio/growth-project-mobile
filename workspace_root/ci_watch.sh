#!/bin/bash
set -euo pipefail

REPO="BradleyGleavePortfolio/growth-project-mobile"
PR=238
EXPECTED_HEAD="207bdc4d9912a6a45c3713a3bf745451c8fd7d11"
MAX_ITERATIONS=30
ITERATION=0
REPORT="/home/user/workspace/PR_238_MERGE_REPORT.md"

echo "Starting CI watch for PR #${PR} at HEAD ${EXPECTED_HEAD}"
echo "Max wait: 30 minutes (30 iterations)"

while [ $ITERATION -lt $MAX_ITERATIONS ]; do
  ITERATION=$((ITERATION + 1))
  TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  echo ""
  echo "=== Iteration ${ITERATION}/30 at ${TIMESTAMP} ==="

  # Poll PR
  PR_JSON=$(gh pr view ${PR} --repo ${REPO} --json headRefOid,mergeable,mergeStateStatus,statusCheckRollup 2>&1)
  echo "Response: ${PR_JSON}"

  # Check HEAD
  HEAD=$(echo "$PR_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['headRefOid'])")
  if [ "$HEAD" != "$EXPECTED_HEAD" ]; then
    echo "HEAD CHANGED: expected ${EXPECTED_HEAD}, got ${HEAD}"
    cat > "$REPORT" << REPORT_EOF
# PR #238 CI Watch + Merge Report

## Final State: HEAD_CHANGED

- Expected HEAD: ${EXPECTED_HEAD}
- Actual HEAD: ${HEAD}
- Last check: ${TIMESTAMP}

HEAD changed — someone else pushed to the branch. Task aborted.

NOT_MERGED: HEAD_CHANGED (expected ${EXPECTED_HEAD}, got ${HEAD})
REPORT_EOF
    echo "NOT_MERGED: HEAD_CHANGED"
    exit 0
  fi

  MERGEABLE=$(echo "$PR_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['mergeable'])")
  MERGE_STATE=$(echo "$PR_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['mergeStateStatus'])")

  # Analyze statusCheckRollup
  STATUS_INFO=$(echo "$PR_JSON" | python3 -c "
import sys, json
d = json.load(sys.stdin)
checks = d.get('statusCheckRollup', [])
statuses = [c.get('status','') for c in checks]
conclusions = [c.get('conclusion','') for c in checks]
in_progress = any(s in ('IN_PROGRESS','QUEUED','PENDING','WAITING','REQUESTED') for s in statuses)
failed = any(c in ('FAILURE','CANCELLED','TIMED_OUT','ACTION_REQUIRED') for c in conclusions)
success = all(c == 'SUCCESS' for c in conclusions) and conclusions
print(f'in_progress={in_progress}')
print(f'failed={failed}')
print(f'success={success}')
print(f'statuses={statuses}')
print(f'conclusions={conclusions}')
")
  echo "$STATUS_INFO"

  IN_PROGRESS=$(echo "$STATUS_INFO" | grep 'in_progress=' | cut -d= -f2)
  FAILED=$(echo "$STATUS_INFO" | grep 'failed=' | cut -d= -f2)
  SUCCESS=$(echo "$STATUS_INFO" | grep 'success=' | cut -d= -f2)

  if [ "$SUCCESS" = "True" ] && [ "$MERGEABLE" = "MERGEABLE" ]; then
    echo "CI SUCCESS and MERGEABLE — merging now..."
    MERGE_OUTPUT=$(gh pr merge ${PR} --repo ${REPO} --squash --admin --delete-branch 2>&1)
    echo "Merge output: ${MERGE_OUTPUT}"
    
    # Get merge commit SHA
    sleep 3
    MERGE_SHA=$(gh pr view ${PR} --repo ${REPO} --json mergeCommit 2>&1 | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('mergeCommit',{}).get('oid','unknown') if d.get('mergeCommit') else 'unknown')")
    echo "Merge SHA: ${MERGE_SHA}"
    
    cat > "$REPORT" << REPORT_EOF
# PR #238 CI Watch + Merge Report

## Final State: MERGED

- Merge SHA: ${MERGE_SHA}
- HEAD at merge: ${EXPECTED_HEAD}
- Last check: ${TIMESTAMP}
- Iterations: ${ITERATION}
- Merge method: squash
- Branch deleted: yes

## CI Status at Merge

\`\`\`
${STATUS_INFO}
\`\`\`

## Merge Output

\`\`\`
${MERGE_OUTPUT}
\`\`\`

MERGED: ${MERGE_SHA}
REPORT_EOF
    echo "MERGED: ${MERGE_SHA}"
    exit 0

  elif [ "$FAILED" = "True" ]; then
    echo "CI FAILURE detected — fetching failed job logs..."
    
    # Get failed check details
    FAILED_JOBS=$(echo "$PR_JSON" | python3 -c "
import sys, json
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
    echo "Failed jobs: ${FAILED_JOBS}"

    # Try to get run logs via API
    RUN_ID=$(echo "$PR_JSON" | python3 -c "
import sys, json, re
d = json.load(sys.stdin)
checks = d.get('statusCheckRollup', [])
failed = [c for c in checks if c.get('conclusion','') in ('FAILURE','CANCELLED','TIMED_OUT','ACTION_REQUIRED')]
for f in failed:
    url = f.get('detailsUrl','')
    m = re.search(r'/runs/(\d+)', url)
    if m:
        print(m.group(1))
        break
")
    
    LOGS=""
    if [ -n "$RUN_ID" ]; then
      echo "Fetching logs for run ${RUN_ID}..."
      LOGS=$(gh run view ${RUN_ID} --repo ${REPO} --log-failed 2>&1 | head -200 || true)
      echo "Log excerpt:"
      echo "$LOGS"
    fi

    cat > "$REPORT" << REPORT_EOF
# PR #238 CI Watch + Merge Report

## Final State: CI_FAILED

- HEAD: ${EXPECTED_HEAD}
- Last check: ${TIMESTAMP}
- Iterations: ${ITERATION}

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
    echo "NOT_MERGED: CI_FAILED"
    exit 0

  elif [ "$IN_PROGRESS" = "True" ]; then
    echo "Still IN_PROGRESS — sleeping 60s..."
    sleep 60
  else
    echo "Unknown state — sleeping 60s..."
    sleep 60
  fi
done

# Timeout
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
echo "TIMEOUT after 30 iterations"
LAST_STATUS=$(gh pr view ${PR} --repo ${REPO} --json headRefOid,mergeable,mergeStateStatus,statusCheckRollup 2>&1)
cat > "$REPORT" << REPORT_EOF
# PR #238 CI Watch + Merge Report

## Final State: TIMEOUT

- HEAD: ${EXPECTED_HEAD}
- Last check: ${TIMESTAMP}
- Iterations: ${MAX_ITERATIONS}
- Max wait exceeded (30 minutes)

## Last Known Status

\`\`\`
${LAST_STATUS}
\`\`\`

NOT_MERGED: TIMEOUT (CI still IN_PROGRESS after 30 minutes)
REPORT_EOF
echo "NOT_MERGED: TIMEOUT"
exit 0
