#!/usr/bin/env bash
# One-off: copy the WhatsApp template rows (approval names, wording) from local abeersuite_dev to live.
# Live rows with the same kind are overwritten; nothing else is touched. Delete this file after use.
set -euo pipefail
cd "$(dirname "$0")"
PSQL="/d/Program Files/PostgreSQL/17/bin/psql.exe"
get(){ grep -E "^$1=" "$2" | head -1 | sed -E "s/^$1=//; s/^\"//; s/\".*$//"; }
LIVE=$(get DIRECT_URL .env); LOC=$(get DIRECT_URL .env.local)
TMP=scratch-wa-templates.csv   # relative: Windows psql cannot read Git Bash's /tmp
"$PSQL" "$LOC" -v ON_ERROR_STOP=1 -c "\copy \"WhatsAppTemplate\" to '$TMP' csv"
"$PSQL" "$LIVE" -v ON_ERROR_STOP=1 <<SQL
begin;
create temp table t (like "WhatsAppTemplate");
\copy t from '$TMP' csv
insert into "WhatsAppTemplate" select * from t
on conflict (kind) do update set
  enabled=excluded.enabled, "autoSend"=excluded."autoSend", body=excluded.body,
  "viewButton"=excluded."viewButton", "appButton"=excluded."appButton", status=excluded.status,
  "metaName"=excluded."metaName", "metaId"=excluded."metaId", "rejectReason"=excluded."rejectReason",
  version=excluded.version, "submittedAt"=excluded."submittedAt", "approvedName"=excluded."approvedName",
  "approvedBody"=excluded."approvedBody", "approvedView"=excluded."approvedView",
  "approvedApp"=excluded."approvedApp", "approvedAt"=excluded."approvedAt", "updatedAt"=now();
select kind, enabled, status, "approvedName" from "WhatsAppTemplate" order by kind;
commit;
SQL
rm -f "$TMP"
