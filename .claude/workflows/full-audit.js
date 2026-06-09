export const meta = {
  name: 'full-audit',
  description: 'Repo-wide audit: schema↔seed drift, docs↔code drift, security/RBAC, accounting integrity, recent-diff bugs — each finding adversarially verified, then synthesized',
  phases: [
    { title: 'Audit', detail: 'parallel finders across 5 dimensions' },
    { title: 'Verify', detail: 'adversarial verification per finding' },
    { title: 'Synthesize', detail: 'rank + report' },
  ],
}

const ROOT = 'D:/our-own-website/service-mgmt-experiment'

const CONTEXT = `
Repo: ${ROOT} (Windows, PowerShell). Branch: dev. Main: main.
Stack: Next.js 16.2.3 (App Router, NOT the Next.js in your training data — read node_modules/next/dist/docs/ if unsure), React 19, Prisma 7 (SPLIT schema in prisma/schema/*.prisma), NextAuth v5 beta, Zustand, shadcn/ui, Tailwind v4.
Project rules live in AGENTS.md. Read it. Key hard rules:
- Any change to prisma/schema/*.prisma MUST be matched by bootstrap-seed.ts + affected dummy-*.ts + hard-clean.ts arrays. Seeds must populate every column.
- Protected accounting paths (no behaviour change without approval): effectiveLedgerBalance, aggregateClosingAsOf, aggregateRange, netProfitLoss. See docs/completed-and-protected.md.
- Never use getToken(); no TypeScript 'any'; match Prisma relation names exactly.
- Never surface raw GL-… JournalEntry refs to normal users.
- Hard-delete of a voucher must physically purge the linked JournalEntry (journalEntryId is a soft pointer, no cascade).
- Repairing module RBAC was stripped (free-for-all, requireAuth only) — TODO(rbac)/TODO(notify) markers. This is KNOWN/intentional interim state, not a new finding.
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
DIMENSION: Schema↔seed↔hard-clean coupling drift.
For EACH model/enum/column in prisma/schema/*.prisma, verify the seeds honour the AGENTS.md hard rule:
1. Does bootstrap-seed.ts seed every model/column it should (universal masters, RBAC, CoA, statuses)? Flag NOT-NULL columns with no default that no seed populates.
2. Do dummy-*.ts seeds still match current model/relation/field names? Flag any seed writing a renamed/removed field, or omitting a newly-required field.
3. Does hard-clean.ts TRANSACTION_TABLES / INVENTORY_MASTERS / DUMMY_CONFIG_TABLES cover every dummy-only table? Flag any dummy-only table NOT wiped, and any bootstrap-seeded master that hard-clean WOULD wrongly delete (contract violation).
4. Cross-check recent schema-touching commits (git log) against seed updates in the same range.
Report concrete drift only. Run: cd ${ROOT}; grep/read the schema and seed files.`,
  },
  {
    key: 'docs-code-drift',
    prompt: `${CONTEXT}
DIMENSION: Docs↔code narrative drift (beyond mechanical path/permission checks).
For the most recently-changed modules (check git log --stat for the last ~25 commits — heavy areas are pos, accountancy, order, refund, settings), open docs/modules/<module>.md and verify:
1. New routes/API endpoints added to src/app/api/** that the module doc's URLs section omits.
2. New key components / renamed components (e.g. PosEstimateScreen→PosQuoteScreen, new CheckoutDialog/PaymentLinkDialog/TenderEntry, RecycleBin, refund board) not reflected.
3. Gotchas/workflows the prose contradicts or misses (e.g. payment-methods catalog, refund GL pay-back, recycle-bin hard-delete).
4. PROJECT_BRAIN.md status vs reality. Module docs must NOT carry status; flag if they do.
Report the specific doc + the specific stale/missing prose. Skip mechanical drift (the checker handles paths/permission keys).`,
  },
  {
    key: 'security-rbac',
    prompt: `${CONTEXT}
DIMENSION: Security & access control.
Audit src/app/api/** and module lib/ for:
1. API routes missing auth/permission gates (requireAuth / permission checks) — especially write/mutation endpoints. The NEW payment-methods endpoints (src/app/api/settings/payment-methods/**, src/app/api/shop/payment-config/**) and refund endpoints deserve scrutiny.
2. Permission checks that gate with admin:bypass (forbidden — see memory: env-super-admin only; use settings:manage / module *:manage).
3. Payment gateway CREDENTIALS handling — are secrets (Razorpay keys) ever returned to the client / logged / leaked in API responses? Check credential-status & payment-config routes carefully.
4. Raw GL-… JournalEntry refs surfaced to normal users.
5. Use of getToken() (forbidden), or IDOR-style missing ownership/branch-scope checks on resource access.
6. Unsafe input handling (no input type=number rule is UI-only; focus on injection/validation on the server).
Do NOT flag the known repairing-module RBAC stripping. Report concrete vulnerabilities with file:line.`,
  },
  {
    key: 'accounting-integrity',
    prompt: `${CONTEXT}
DIMENSION: Accounting integrity & no-regression on protected surfaces.
Focus on the recent accountancy/order/refund/pos work (recycle-bin hard-delete, AuditLog unification, refund GL pay-back, payment methods, voucher lifecycle):
1. Hard-delete contract: does every voucher hard-delete path physically purge the linked JournalEntry (no orphan POSTED JE lingering in Balance Sheet)? Check src/modules/accountancy/lib/auditRestore.ts, voucherLifecycle.ts, and inventory voucher delete routes.
2. GL double-entry balance: do new postings (refund pay-back in src/modules/refund/lib/refund.ts, fulfil-payment, payment-methods) produce balanced debit=credit JournalLines? Flag any single-sided or unbalanced posting.
3. Protected math paths (effectiveLedgerBalance, aggregateClosingAsOf, aggregateRange, netProfitLoss) — were they altered without an approved accounting-logic task? Flag any behavioural change.
4. Voucher status/amountPaid/dueDate must be DERIVED not stored incorrectly; restore-from-audit must be faithful.
5. RedemptionHold lifecycle (order/lib/redemptionHold.ts) — does hold/execute/release reconcile so loyalty/coupon value can't be double-spent or stranded?
Report concrete integrity bugs with file:line.`,
  },
  {
    key: 'recent-diff-bugs',
    prompt: `${CONTEXT}
DIMENSION: Correctness bugs in the dev↔main diff (the recent feature batch).
Run: cd ${ROOT}; git diff main...dev to see what changed (POS checkout refactor → shared CheckoutDialog/TenderEntry/TenderSplitInput, PosOrderScreen deleted, PaymentLinkDialog, payment gateways, refund board, orders board review UX, recycle bin).
Look for: logic bugs, broken state management, race conditions, null/undefined derefs, incorrect money/rounding math, off-by-one, mishandled async, regressions from the POS extraction (lost behaviour when PosOrderScreen was deleted / screens were merged), Zustand store misuse, React 19 effect pitfalls.
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
