#!/usr/bin/env bash
# Posts Claude's alert investigation findings (findings/findings.md, downloaded from the investigate job) to
# Slack, and to the job summary. The findings are Slack mrkdwn written from telemetry Claude read, so their
# length is capped and they can't ping the whole channel. If there are no findings, says the investigation
# didn't finish instead.
# Requires ALERT (the alert payload) and RUN_URL; SLACK_WEBHOOK_URL is optional.
set -euo pipefail

rule=$(printf '%s' "$ALERT" | jq -r '.data.essentials.alertRule // .data.BudgetName // "the alert"' 2>/dev/null || echo "the alert")
if [ -s findings/findings.md ]; then
  findings=$(head -c 3500 findings/findings.md | sed -E 's/<!(channel|here|everyone|subteam)/\&lt;!\1/g')
  text="${findings}"$'\n'"<${RUN_URL}|Investigation run>"
else
  text=":warning: Claude couldn't finish investigating *${rule}*. See the <${RUN_URL}|investigation run>."
fi
printf '%s\n' "$text" >>"$GITHUB_STEP_SUMMARY"

if [ -z "${SLACK_WEBHOOK_URL:-}" ]; then
  echo "::warning::SLACK_WEBHOOK_URL isn't set, so the findings are only in the job summary."
  exit 0
fi
jq -n --arg text "$text" '{text: $text}' |
  curl --fail-with-body --silent --show-error -X POST -H 'Content-Type: application/json' --data @- "$SLACK_WEBHOOK_URL"
