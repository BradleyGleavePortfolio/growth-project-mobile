#!/usr/bin/env bash
# CI Runner Recovery Watcher
# Monitors GitHub hosted-runner pool for BradleyGleavePortfolio/growth-project-mobile
# and re-dispatches CI for PRs #235 and #237 once recovered.

REPO="BradleyGleavePortfolio/growth-project-mobile"
WORKFLOW_ID="265423898"
PR_235=235
PR_237=237
HEAD_235="918fa47e3968ccb5ef18ec2312fb42c21b8a05f3"
HEAD_237="21ce3e01f753b9d48089f25df2b07f54c032262b"
BRANCH_235="feature/community-v3-challenges-mobile"
BRANCH_237="feature/mwb-4-mobile-autosave"
REPORT="/home/user/workspace/CI_OUTAGE_WATCH_REPORT.md"
LOG="/home/user/workspace/ci_watcher.log"
HEALTH_PY="/home/user/workspace/health_check.py"
FIND_RUN_PY="/home/user/workspace/find_run.py"
MAX_ITERATIONS=30
POLL_INTERVAL=180
CI_POLL_INTERVAL=60
MAX_CI_WAIT=3600

log() {
    echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*" | tee -a "$LOG"
}

# ─────────────────────────────────────────────
check_pool_health() {
    local runs_json
    runs_json=$(gh run list --repo "$REPO" --limit 10 \
        --json databaseId,status,conclusion,createdAt,startedAt,updatedAt 2>/dev/null || echo "[]")
    log "Recent runs: $runs_json"
    local now_ts result
    now_ts=$(date +%s)
    result=$(echo "$runs_json" | python3 "$HEALTH_PY" "$now_ts" 2>>"$LOG")
    local py_exit=$?
    log "  health result: $result"
    [[ $py_exit -eq 0 && "$result" == RECOVERED:* ]]
}

# ─────────────────────────────────────────────
dispatch_ci() {
    local branch="$1"
    log "Dispatching CI for: $branch"
    local out
    out=$(gh api -X POST "repos/$REPO/actions/workflows/$WORKFLOW_ID/dispatches" \
        -f "ref=$branch" 2>&1) || true
    log "  dispatch output: ${out:-<empty - 204 OK>}"
}

# ─────────────────────────────────────────────
find_run_for_branch() {
    local branch="$1"
    local after_ts="$2"
    local max_attempts=12
    local attempt=0
    while [[ $attempt -lt $max_attempts ]]; do
        local runs run_id
        runs=$(gh run list --repo "$REPO" --branch "$branch" --limit 5 \
            --json databaseId,status,conclusion,createdAt,headSha 2>/dev/null || echo "[]")
        run_id=$(echo "$runs" | python3 "$FIND_RUN_PY" "$after_ts" 2>/dev/null) || true
        if [[ -n "$run_id" ]]; then
            echo "$run_id"
            return 0
        fi
        log "  Waiting for run on $branch (attempt $((attempt+1))/$max_attempts)..."
        sleep 15
        attempt=$(( attempt + 1 ))
    done
    echo ""
    return 1
}

# ─────────────────────────────────────────────
wait_for_run() {
    local run_id="$1"
    local label="$2"
    local max_wait="$3"
    local start_ts
    start_ts=$(date +%s)
    while true; do
        local now_ts elapsed
        now_ts=$(date +%s)
        elapsed=$(( now_ts - start_ts ))
        if [[ $elapsed -gt $max_wait ]]; then
            log "  [$label] Run $run_id timed out after ${elapsed}s"
            echo "timeout"
            return
        fi
        local json status conclusion
        json=$(gh run view "$run_id" --repo "$REPO" --json status,conclusion 2>/dev/null \
            || echo '{"status":"unknown","conclusion":""}')
        status=$(echo "$json" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','unknown'))" 2>/dev/null || echo "unknown")
        conclusion=$(echo "$json" | python3 -c "import sys,json; v=json.load(sys.stdin).get('conclusion'); print(v or '')" 2>/dev/null || echo "")
        log "  [$label] Run $run_id: status=$status conclusion=$conclusion elapsed=${elapsed}s"
        if [[ "$status" == "completed" ]]; then
            echo "$conclusion"
            return
        fi
        sleep $CI_POLL_INTERVAL
    done
}

# ─────────────────────────────────────────────
get_failure_logs() {
    local run_id="$1"
    local jobs_json
    jobs_json=$(gh api "repos/$REPO/actions/runs/$run_id/jobs" 2>/dev/null || echo '{"jobs":[]}')
    local failed_summary failed_job_id
    failed_summary=$(echo "$jobs_json" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for j in data.get('jobs', []):
    if j.get('conclusion') == 'failure':
        print(f'  Job: {j.get(\"name\")} (id={j.get(\"id\")}) -> failure')
        for s in j.get('steps', []):
            if s.get('conclusion') == 'failure':
                print(f'    Step: {s.get(\"name\")} -> failure')
" 2>/dev/null || echo "  Could not parse jobs")
    failed_job_id=$(echo "$jobs_json" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for j in data.get('jobs', []):
    if j.get('conclusion') == 'failure':
        print(j.get('id',''))
        break
" 2>/dev/null || echo "")
    echo "$failed_summary"
    if [[ -n "$failed_job_id" ]]; then
        log "  Fetching logs for job $failed_job_id"
        local logs
        logs=$(gh api "repos/$REPO/actions/jobs/$failed_job_id/logs" 2>/dev/null | tail -80 \
            || echo "Could not fetch logs")
        echo "--- Job $failed_job_id logs (last 80 lines) ---"
        echo "$logs"
    fi
}

# ─────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────
RECOVERY_TIME=""
DISPATCH_TS=""
RESULT_235="pending"
RESULT_237="pending"
MERGE_SHA_235=""
MERGE_SHA_237=""
FAILURE_LOGS_235=""
FAILURE_LOGS_237=""
RUN_ID_235=""
RUN_ID_237=""
FINAL_RESULT=""
CURRENT_HEAD_235=""
CURRENT_HEAD_237=""
SHA_MISMATCH=""

log "=== CI Runner Recovery Watcher starting ==="
log "Repo: $REPO | Workflow: $WORKFLOW_ID"
log "PR #235 branch=$BRANCH_235 head=$HEAD_235"
log "PR #237 branch=$BRANCH_237 head=$HEAD_237"

# ── PHASE 1: WAIT FOR RECOVERY ──
RECOVERED=false
for i in $(seq 1 $MAX_ITERATIONS); do
    log "--- Health check $i/$MAX_ITERATIONS ---"
    if check_pool_health; then
        RECOVERY_TIME=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
        log "=== RECOVERED at $RECOVERY_TIME ==="
        RECOVERED=true
        break
    fi
    if [[ $i -lt $MAX_ITERATIONS ]]; then
        log "Still in outage. Sleeping ${POLL_INTERVAL}s..."
        sleep $POLL_INTERVAL
    fi
done

if [[ "$RECOVERED" != "true" ]]; then
    log "=== TIMEOUT: No recovery after 90 minutes ==="
    cat > "$REPORT" <<EOF
# CI Outage Watch Report

**Generated:** $(date -u '+%Y-%m-%dT%H:%M:%SZ')

## Outage Recovery Detection
- Status: **TIMEOUT** — runner pool did not recover within 90 minutes

## PR #235
- Branch: \`$BRANCH_235\`
- Expected HEAD: \`$HEAD_235\`
- Final State: PENDING — CI never dispatched

## PR #237
- Branch: \`$BRANCH_237\`
- Expected HEAD: \`$HEAD_237\`
- Final State: PENDING — CI never dispatched

## Summary
Runner pool never showed recovery signals within 30 poll iterations (90 minutes).

RESULT: TIMEOUT
EOF
    log "Report written to $REPORT"
    exit 0
fi

# ── PHASE 2: DISPATCH CI ──
log "=== Dispatching CI ==="
DISPATCH_TS=$(date +%s)
dispatch_ci "$BRANCH_235"
sleep 5
dispatch_ci "$BRANCH_237"
log "Dispatches sent at epoch $DISPATCH_TS. Waiting 30s..."
sleep 30

# ── PHASE 3: FIND RUN IDs ──
log "=== Locating dispatched run IDs ==="
RUN_ID_235=$(find_run_for_branch "$BRANCH_235" "$DISPATCH_TS") || RUN_ID_235=""
log "PR #235 run ID: ${RUN_ID_235:-NOT_FOUND}"
RUN_ID_237=$(find_run_for_branch "$BRANCH_237" "$DISPATCH_TS") || RUN_ID_237=""
log "PR #237 run ID: ${RUN_ID_237:-NOT_FOUND}"

if [[ -z "$RUN_ID_235" || -z "$RUN_ID_237" ]]; then
    log "ERROR: Could not find one or both dispatched run IDs."
    DISPATCH_ISO=$(date -u -d "@$DISPATCH_TS" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || echo "$DISPATCH_TS")
    cat > "$REPORT" <<EOF
# CI Outage Watch Report

**Generated:** $(date -u '+%Y-%m-%dT%H:%M:%SZ')

## Outage Recovery Detection
- Recovery detected at: **$RECOVERY_TIME**
- Dispatches sent at: $DISPATCH_ISO

## PR #235
- Branch: \`$BRANCH_235\`
- Run ID: ${RUN_ID_235:-NOT FOUND}
- Final State: ERROR — dispatched run not located

## PR #237
- Branch: \`$BRANCH_237\`
- Run ID: ${RUN_ID_237:-NOT FOUND}
- Final State: ERROR — dispatched run not located

RESULT: NEITHER_MERGED:run-id-lookup-failed
EOF
    log "Report written to $REPORT"
    exit 1
fi

# ── PHASE 4: VERIFY HEAD SHAs ──
log "=== Verifying HEAD SHAs ==="
CURRENT_HEAD_235=$(gh pr view $PR_235 --repo "$REPO" --json headRefOid --jq '.headRefOid' 2>/dev/null || echo "unknown")
CURRENT_HEAD_237=$(gh pr view $PR_237 --repo "$REPO" --json headRefOid --jq '.headRefOid' 2>/dev/null || echo "unknown")
log "PR #235: expected=$HEAD_235 current=$CURRENT_HEAD_235"
log "PR #237: expected=$HEAD_237 current=$CURRENT_HEAD_237"

SHA_MISMATCH=""
[[ "$CURRENT_HEAD_235" != "$HEAD_235" ]] && SHA_MISMATCH="${SHA_MISMATCH}235 "
[[ "$CURRENT_HEAD_237" != "$HEAD_237" ]] && SHA_MISMATCH="${SHA_MISMATCH}237 "
SHA_MISMATCH="${SHA_MISMATCH%% }"

if [[ -n "$SHA_MISMATCH" ]]; then
    log "ABORTING: HEAD SHA changed for PR(s): $SHA_MISMATCH"
    cat > "$REPORT" <<EOF
# CI Outage Watch Report

**Generated:** $(date -u '+%Y-%m-%dT%H:%M:%SZ')

## Outage Recovery Detection
- Recovery detected at: **$RECOVERY_TIME**

## PR #235
- Branch: \`$BRANCH_235\`
- Expected HEAD: \`$HEAD_235\`
- Current HEAD: \`$CURRENT_HEAD_235\`
- Final State: ABORTED — HEAD SHA changed

## PR #237
- Branch: \`$BRANCH_237\`
- Expected HEAD: \`$HEAD_237\`
- Current HEAD: \`$CURRENT_HEAD_237\`
- Final State: ABORTED — HEAD SHA changed

RESULT: NEITHER_MERGED:head-sha-changed-pr-${SHA_MISMATCH// /-}
EOF
    log "Report written to $REPORT"
    exit 1
fi

# ── PHASE 5: WAIT FOR CI ──
log "=== Waiting for CI runs: #235=$RUN_ID_235, #237=$RUN_ID_237 ==="
RESULT_FILE_235="/tmp/ci_result_235_$$.txt"
RESULT_FILE_237="/tmp/ci_result_237_$$.txt"

wait_for_run "$RUN_ID_235" "PR#235" "$MAX_CI_WAIT" > "$RESULT_FILE_235" &
PID_235=$!
wait_for_run "$RUN_ID_237" "PR#237" "$MAX_CI_WAIT" > "$RESULT_FILE_237" &
PID_237=$!

wait $PID_235 || true
wait $PID_237 || true

RESULT_235=$(tail -1 "$RESULT_FILE_235" 2>/dev/null | tr -d '[:space:]' || echo "unknown")
RESULT_237=$(tail -1 "$RESULT_FILE_237" 2>/dev/null | tr -d '[:space:]' || echo "unknown")
log "CI done: PR#235=$RESULT_235  PR#237=$RESULT_237"

# ── PHASE 6: RE-VERIFY HEAD SHAs ──
log "=== Re-verifying HEAD SHAs before merge ==="
CURRENT_HEAD_235=$(gh pr view $PR_235 --repo "$REPO" --json headRefOid --jq '.headRefOid' 2>/dev/null || echo "unknown")
CURRENT_HEAD_237=$(gh pr view $PR_237 --repo "$REPO" --json headRefOid --jq '.headRefOid' 2>/dev/null || echo "unknown")
log "PR #235: $HEAD_235 vs $CURRENT_HEAD_235"
log "PR #237: $HEAD_237 vs $CURRENT_HEAD_237"
SHA_MISMATCH=""
[[ "$CURRENT_HEAD_235" != "$HEAD_235" ]] && SHA_MISMATCH="${SHA_MISMATCH}235 "
[[ "$CURRENT_HEAD_237" != "$HEAD_237" ]] && SHA_MISMATCH="${SHA_MISMATCH}237 "
SHA_MISMATCH="${SHA_MISMATCH%% }"

# ── PHASE 7: MERGE ──
MERGED_235=false
MERGED_237=false

merge_pr() {
    local pr_num="$1"
    log "Merging PR #$pr_num..."
    local out
    out=$(gh pr merge "$pr_num" --repo "$REPO" --admin --squash --delete-branch 2>&1) || {
        log "ERROR merging PR #$pr_num: $out"
        echo "MERGE_ERROR"
        return 1
    }
    log "Merge output: $out"
    local sha
    sha=$(gh pr view "$pr_num" --repo "$REPO" --json mergeCommit --jq '.mergeCommit.oid' 2>/dev/null || echo "unknown")
    log "PR #$pr_num merge SHA: $sha"
    echo "$sha"
}

if [[ "$RESULT_235" == "success" && -z "$SHA_MISMATCH" ]]; then
    MERGE_SHA_235=$(merge_pr $PR_235) || MERGE_SHA_235="MERGE_ERROR"
    [[ "$MERGE_SHA_235" != "MERGE_ERROR" && -n "$MERGE_SHA_235" ]] && MERGED_235=true
else
    log "PR #235 skip merge: result=$RESULT_235 sha_mismatch='$SHA_MISMATCH'"
    if [[ "$RESULT_235" != "success" ]]; then
        FAILURE_LOGS_235=$(get_failure_logs "$RUN_ID_235" 2>/dev/null || echo "Could not fetch logs")
    fi
fi

if [[ "$RESULT_237" == "success" && -z "$SHA_MISMATCH" ]]; then
    MERGE_SHA_237=$(merge_pr $PR_237) || MERGE_SHA_237="MERGE_ERROR"
    [[ "$MERGE_SHA_237" != "MERGE_ERROR" && -n "$MERGE_SHA_237" ]] && MERGED_237=true
else
    log "PR #237 skip merge: result=$RESULT_237 sha_mismatch='$SHA_MISMATCH'"
    if [[ "$RESULT_237" != "success" ]]; then
        FAILURE_LOGS_237=$(get_failure_logs "$RUN_ID_237" 2>/dev/null || echo "Could not fetch logs")
    fi
fi

# ── PHASE 8: RESULT ──
if [[ "$MERGED_235" == "true" && "$MERGED_237" == "true" ]]; then
    FINAL_RESULT="BOTH_MERGED"
elif [[ "$MERGED_235" == "true" ]]; then
    FINAL_RESULT="ONE_MERGED:235"
elif [[ "$MERGED_237" == "true" ]]; then
    FINAL_RESULT="ONE_MERGED:237"
elif [[ -n "$SHA_MISMATCH" ]]; then
    FINAL_RESULT="NEITHER_MERGED:head-sha-changed-pr-${SHA_MISMATCH// /-}"
elif [[ "$RESULT_235" != "success" && "$RESULT_237" != "success" ]]; then
    FINAL_RESULT="NEITHER_MERGED:both-ci-failed-${RESULT_235}/${RESULT_237}"
elif [[ "$RESULT_235" != "success" ]]; then
    FINAL_RESULT="NEITHER_MERGED:pr235-ci-${RESULT_235}"
else
    FINAL_RESULT="NEITHER_MERGED:pr237-ci-${RESULT_237}"
fi

# ── PHASE 9: REPORT ──
DISPATCH_ISO=$(date -u -d "@$DISPATCH_TS" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || echo "$DISPATCH_TS")

{
    echo "# CI Outage Watch Report"
    echo ""
    echo "**Generated:** $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    echo ""
    echo "## Outage Recovery Detection"
    echo "- Recovery detected at: **$RECOVERY_TIME**"
    echo "- Dispatches sent at: $DISPATCH_ISO"
    echo ""
    echo "## PR #235 (\`$BRANCH_235\`)"
    echo "- Expected HEAD: \`$HEAD_235\`"
    echo "- Current HEAD:  \`$CURRENT_HEAD_235\`"
    echo "- Run ID: $RUN_ID_235"
    echo "- CI Result: **$RESULT_235**"
    echo "- Merged: $MERGED_235"
    echo "- Merge SHA: ${MERGE_SHA_235:-N/A}"
    if [[ -n "$FAILURE_LOGS_235" ]]; then
        echo ""
        echo "### Failure Logs"
        echo '```'
        echo "$FAILURE_LOGS_235"
        echo '```'
    fi
    echo ""
    echo "## PR #237 (\`$BRANCH_237\`)"
    echo "- Expected HEAD: \`$HEAD_237\`"
    echo "- Current HEAD:  \`$CURRENT_HEAD_237\`"
    echo "- Run ID: $RUN_ID_237"
    echo "- CI Result: **$RESULT_237**"
    echo "- Merged: $MERGED_237"
    echo "- Merge SHA: ${MERGE_SHA_237:-N/A}"
    if [[ -n "$FAILURE_LOGS_237" ]]; then
        echo ""
        echo "### Failure Logs"
        echo '```'
        echo "$FAILURE_LOGS_237"
        echo '```'
    fi
    echo ""
    echo "## Final Summary"
    if [[ "$MERGED_235" == "true" ]]; then
        echo "- PR #235: **MERGED** (SHA: $MERGE_SHA_235)"
    else
        echo "- PR #235: NOT MERGED (CI: $RESULT_235)"
    fi
    if [[ "$MERGED_237" == "true" ]]; then
        echo "- PR #237: **MERGED** (SHA: $MERGE_SHA_237)"
    else
        echo "- PR #237: NOT MERGED (CI: $RESULT_237)"
    fi
    echo ""
    echo "RESULT: $FINAL_RESULT"
} > "$REPORT"

log "=== COMPLETE: $FINAL_RESULT ==="
log "Report written to $REPORT"
echo "FINAL_RESULT: $FINAL_RESULT"
