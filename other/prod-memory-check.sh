#!/usr/bin/env bash
# Queries Fly's Prometheus for the prod box's memory headroom and exits
# non-zero past thresholds, so the scheduled workflow fails and GitHub emails
# a warning DAYS before a slow leak reaches the in-process watchdog's
# restart thresholds (server/memory-watchdog.ts), which sit well before the
# box would start thrashing. Needs FLY_METRICS_TOKEN (a readonly org token,
# passed verbatim as the Authorization header).
set -euo pipefail

APP=${FLY_APP:-quartermaster-94e5}
MIN_AVAILABLE_MB=${MIN_AVAILABLE_MB:-75}
MAX_SWAP_USED_MB=${MAX_SWAP_USED_MB:-150}
PROM_URL="https://api.fly.io/prometheus/personal/api/v1/query"

query_mb() {
	local value
	value=$(
		curl -sf --get "$PROM_URL" \
			--data-urlencode "query=$1" \
			-H "Authorization: $FLY_METRICS_TOKEN" |
			jq -er '.data.result[0].value[1]'
	) || return 1
	awk -v b="$value" 'BEGIN { printf "%d", b / 1048576 }'
}

# An empty result is itself an alert: app gone, metrics broken, or the token
# expired — all states where this monitor is blind and must say so.
avail_mb=$(query_mb "fly_instance_memory_mem_available{app=\"$APP\"}") || {
	echo "::error::No mem_available datapoint for $APP — app down, metrics broken, or FLY_METRICS_TOKEN expired"
	exit 1
}
swap_mb=$(query_mb "fly_instance_memory_swap_total{app=\"$APP\"} - fly_instance_memory_swap_free{app=\"$APP\"}") || {
	echo "::error::No swap datapoint for $APP — app down, metrics broken, or FLY_METRICS_TOKEN expired"
	exit 1
}

echo "mem_available=${avail_mb}MB swap_used=${swap_mb}MB (alert when <${MIN_AVAILABLE_MB}MB or >${MAX_SWAP_USED_MB}MB)"

status=0
if ((avail_mb < MIN_AVAILABLE_MB)); then
	echo "::error::MemAvailable ${avail_mb}MB < ${MIN_AVAILABLE_MB}MB on $APP — close to thrashing; restart the machine and look for a leak"
	status=1
fi
if ((swap_mb > MAX_SWAP_USED_MB)); then
	echo "::error::Swap used ${swap_mb}MB > ${MAX_SWAP_USED_MB}MB on $APP — something has been leaking for days; see prod-memory-leak history"
	status=1
fi
exit $status
