export const meta = {
  name: 'full-audit',
  description: 'Repo-wide audit: schema/seed drift, docs/code drift, security/RBAC, accounting integrity, recent-diff bugs - each finding adversarially verified, then synthesized',
  phases: [
    { title: 'Audit', detail: 'parallel finders across 5 dimensions' },
    { title: 'Verify', detail: 'adversarial verification per finding' },
    { title: 'Synthesize', detail: 'rank + report' },
  ],
}

const ROOT = 'D:/AbeerSuite/abeersuite-electron'
const LAST_TAG = 'v5.0.3'

const CONTEXT = `
Repo: ${ROOT} (Windows). Branch: main (releases go out from main; dev is level with it). Last release tag before the current batch: ${LAST_TAG}.
Stack: Next.js 16 App Router (NOT the Next.js in your training data - read node_modules/next/dist/docs/ if unsure), React 19, Prisma 7 (SPLIT schema in prisma/schema/*.prisma), NextAuth v5 beta, Zustand, shadcn/ui, Tailwind v4, Electron 43 desktop shell (electron/*.ts: main, serverManager, postgresManager, localDbProvisioner, backupManager, hardwareBridgeManager, replicaWipe).
The app runs in variants: office (web/Supabase), counter (Electron with a local PostgreSQL replica that syncs to Supabase). CURRENT_DB=demo locally; live is production, never full-reset.
Project rules live in AGENTS.md - read it. Also read docs/seeds.md. Key hard rules:
- Seeds: sync-permissions.ts --apply / pnpm prisma db seed = catalog permissions + R1 top-up, safe on live; real config lives only in the DB (restore from backup). bootstrap-seed.ts = generic client setup. hard-clean.ts = remove dummy/helper data only. Every schema/permission/master-data change must update lib/codeOwnedCatalog.ts and a targeted apply-*.ts script; plus affected dummy-*.ts / hard-clean.ts arrays.
- Anything read from Supabase/DB must be cached to save reading cost.
- Protected accounting math paths (no behaviour change without approval): effectiveLedgerBalance, aggregateClosingAsOf, aggregateRange, netProfitLoss.
- Never use getToken(); no TypeScript 'any'; match Prisma relation names exactly.
- Never surface raw GL-... JournalEntry refs to normal users.
- Hard-delete of a voucher must physically purge the linked JournalEntry (journalEntryId is a soft pointer, no cascade).
- Repairing module RBAC is intentionally stripped (requireAuth only, TODO(rbac)/TODO(notify) markers). KNOWN interim state, not a finding.
- PROJECT_BRAIN.md is the only status doc; docs/*.md are narrative.
You may use Read, Grep, Glob, and Bash to investigate. Be concrete: cite file:line. Do NOT report style nits or the known interim states above.
`

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'severity', 'file', 'evidence', 'why'],
        properties: {
          title: { type: 'string', description: 'one-line summary' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          file: { type: 'string', description: 'path:line, or path if line unknown' },
          evidence: { type: 'string', description: 'concrete code/quote proving the issue' },
          why: { type: 'string', description: 'why it is a problem / what breaks' },
          fix: { type: 'string', description: 'suggested remedy (optional)' },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['isReal', 'confidence', 'reasoning', 'correctedSeverity'],
  properties: {
    isReal: { type: 'boolean', description: 'true only if you confirmed the issue against the actual code' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    reasoning: { type: 'string', description: 'what you checked and concluded' },
    correctedSeverity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'none'] },
  },
}

const DIMENSIONS = [
  {
    key: 'schema-seed-drift',
    prompt: `${CONTEXT}
DIMENSION: Schema <-> seed <-> hard-clean coupling drift.
For EACH model/enum/column in prisma/schema/*.prisma, verify the seeds in prisma/seeds/ honour the AGENTS.md rules:
1. Does bootstrap-seed.ts / sync-permissions.ts (+ lib/codeOwnedCatalog.ts) seed every model/column it should (universal masters, RBAC/permissions, CoA, statuses)? Flag NOT-NULL columns with no default that no seed populates.
2. Do dummy-*.ts and helper-*.ts seeds still match current model/relation/field names? Flag any seed writing a renamed/removed field, or omitting a newly-required field.
3. Does hard-clean.ts TRANSACTION_TABLES / INVENTORY_MASTERS / DUMMY_CONFIG_TABLES cover every dummy-only table? Flag any dummy-only table NOT wiped, and any bootstrap-seeded master that hard-clean WOULD wrongly delete.
4. Cross-check schema-touching commits since ${LAST_TAG} (git log ${LAST_TAG}..HEAD --stat -- prisma/) against seed + migration updates in the same range. Every schema change needs a migration under prisma/migrations.
Report concrete drift only.`,
  },
  {
    key: 'docs-code-drift',
    prompt: `${CONTEXT}
DIMENSION: Docs <-> code narrative drift.
Run git log ${LAST_TAG}..HEAD --stat to see the recent batch (printer/display status, Supabase backup & restore from desktop, local-write counter sale fix, realtime live-update sweep, offline policies, installer/VC++ runtime, release skill). Then verify against PROJECT_BRAIN.md, docs/commands.md, docs/seeds.md, docs/electron-offline-sync-roadmap.md, docs/backup-schedule-activation.md, docs/pos-conventions.md, RELEASE_NOTES.md, AGENTS.md and .claude/skills/release:
1. New routes/API endpoints under src/app/api/** or Electron IPC channels (electron/preload.ts) that the docs omit or describe wrongly.
2. Renamed/removed components, settings or commands still referenced by docs (e.g. ServiceMgmt naming, per-machine company name that was dropped).
3. Behaviour the prose contradicts (counter local-write mode, backup/restore flow, offline policy enforcement).
4. PROJECT_BRAIN.md status vs reality. Narrative docs must NOT carry status; flag if they do.
Report the specific doc + the specific stale/missing prose. Run pnpm seed:check-docs if it exists and include its drift.`,
  },
  {
    key: 'security-rbac',
    prompt: `${CONTEXT}
DIMENSION: Security & access control.
Audit src/app/api/**, module lib/, and electron/*.ts for:
1. API routes missing auth/permission gates (requireAuth / permission checks) - especially write/mutation endpoints. The counter, backup/restore, health, cron, external, and settings endpoints deserve scrutiny.
2. Permission checks that gate with admin:bypass (forbidden - env super-admin only; use settings:manage / module *:manage).
3. Secrets handling - Supabase service keys, DB connection strings, payment gateway keys, backup archives: ever returned to the renderer/client, logged, written to disk unencrypted, or leaked in API responses? Check electron/backupManager.ts, electron/preload.ts IPC surface, and the backup/restore API.
4. Electron: contextIsolation/nodeIntegration settings, IPC handlers that accept arbitrary paths/commands from the renderer, LAN 0.0.0.0 bind (known dev-only; only flag if it leaks secrets or unauthenticated writes).
5. Raw GL-... JournalEntry refs surfaced to normal users; use of getToken(); IDOR-style missing ownership/branch/company-scope checks.
6. Server-side input validation gaps (injection, unvalidated bodies on mutation routes).
Do NOT flag the known repairing-module RBAC stripping. Report concrete vulnerabilities with file:line.`,
  },
  {
    key: 'accounting-integrity',
    prompt: `${CONTEXT}
DIMENSION: Accounting integrity & no-regression on protected surfaces.
Focus on src/modules/accountancy, order, pos, refund, inventory, and the counter local-write path:
1. Hard-delete contract: does every voucher hard-delete path physically purge the linked JournalEntry (no orphan POSTED JE lingering in Balance Sheet)? Check auditRestore / voucherLifecycle and inventory voucher delete routes.
2. GL double-entry balance: do postings (sale, receipt, refund pay-back, fulfil-payment, payment-methods, online-payment RECEIPT) produce balanced debit=credit JournalLines? Flag any single-sided or unbalanced posting.
3. Protected math paths (effectiveLedgerBalance, aggregateClosingAsOf, aggregateRange, netProfitLoss) - any behavioural change since ${LAST_TAG}? (git log -p ${LAST_TAG}..HEAD on those files.)
4. Voucher status/amountPaid/dueDate must be DERIVED, not stored incorrectly; restore-from-audit must be faithful.
5. Counter local-write + sync: voucher numbering / reference counters (recent fix: counter part of a reference is the counter, not creator id), applyIdRanges, and sync conflicts - can two counters or counter+office produce duplicate numbers or double-post a JE?
6. RedemptionHold / loyalty / coupon / gift-card value: can it be double-spent or stranded?
Report concrete integrity bugs with file:line.`,
  },
  {
    key: 'recent-diff-bugs',
    prompt: `${CONTEXT}
DIMENSION: Correctness bugs in the recent batch.
Run: cd ${ROOT}; git diff ${LAST_TAG}..HEAD --stat, then read the diffs (git diff ${LAST_TAG}..HEAD -- <path>) for: electron/backupManager.ts and the backup/restore UI+API, printer/display status in settings, hardwareBridgeManager, local-write counter sale save (fix 393ca532), realtime live-update sweep (registers, books, boards), Offline Policies page, vouchers reference counter fix, receipts/inbox Position-appointment changes, installer/downloader changes.
Look for: logic bugs, broken state management, race conditions, null/undefined derefs, incorrect money/rounding math, off-by-one, mishandled async/IPC, restore that can clobber live data or half-apply, realtime subscriptions that leak or double-fire, Zustand store misuse, React 19 effect pitfalls, DB reads that bypass the cache rule.
Prioritise money-affecting and data-loss bugs. Report concrete bugs with file:line and the failing scenario.`,
  },
]

phase('Audit')
log(`Auditing ${DIMENSIONS.length} dimensions, each finding then adversarially verified`)

const perDimension = await pipeline(
  DIMENSIONS,
  (d) => agent(d.prompt, { label: `audit:${d.key}`, phase: 'Audit', schema: FINDINGS_SCHEMA }),
  (review, d) => {
    const findings = (review?.findings ?? [])
    if (!findings.length) return { key: d.key, verified: [] }
    return parallel(
      findings.map((f) => () =>
        agent(
          `${CONTEXT}\nADVERSARIAL VERIFICATION. A prior audit (dimension: ${d.key}) reported this finding. Your job is to REFUTE it. Open the cited file and surrounding code yourself. Default to isReal=false unless the evidence holds up against the real code. Re-rate severity honestly (a real-but-trivial issue is low/none).\n\nFINDING: ${f.title}\nSEVERITY(claimed): ${f.severity}\nFILE: ${f.file}\nEVIDENCE: ${f.evidence}\nWHY: ${f.why}`,
          { label: `verify:${d.key}:${f.file}`.slice(0, 80), phase: 'Verify', schema: VERDICT_SCHEMA },
        ).then((v) => ({ finding: f, verdict: v })),
      ),
    ).then((verified) => ({ key: d.key, verified: verified.filter(Boolean) }))
  },
)

phase('Synthesize')
const confirmed = perDimension
  .filter(Boolean)
  .flatMap((d) => (d.verified ?? []).map((v) => ({ dimension: d.key, ...v })))
  .filter((v) => v.verdict?.isReal && v.verdict.correctedSeverity !== 'none')

log(`${confirmed.length} confirmed findings across ${perDimension.filter(Boolean).length} dimensions`)

const synthesis = await agent(
  `${CONTEXT}
You are the lead auditor writing the final report. Below are findings that survived adversarial verification (isReal=true). De-duplicate overlapping findings, group by area, and rank by real-world impact (money/data-loss/security first). For each: keep title, final severity (use the corrected severity), file:line, a one-line why, and the suggested fix. Then write a short executive summary (3-6 sentences) of the repo's overall health and the top 3 things to fix first.

VERIFIED FINDINGS (JSON):
${JSON.stringify(confirmed.map((c) => ({ dimension: c.dimension, severity: c.verdict.correctedSeverity, confidence: c.verdict.confidence, title: c.finding.title, file: c.finding.file, why: c.finding.why, fix: c.finding.fix, verifierNote: c.verdict.reasoning })), null, 2)}

Output a clean Markdown report.`,
  { label: 'synthesize', phase: 'Synthesize' },
)

return { confirmedCount: confirmed.length, report: synthesis, raw: confirmed }
