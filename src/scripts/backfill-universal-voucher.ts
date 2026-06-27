// Phase 4 backfill — RETIRED (2026-06-27, G5).
//
// The universal-voucher spine is now the SOLE general ledger; the legacy
// JournalEntry/JournalLine tables it used to reconcile against are dropped. The
// migration is complete, so there is nothing left to backfill and no legacy GL
// to drift-check. Kept as a no-op so any lingering `--check` invocation in CI /
// scripts still exits 0.
//
// Run:  pnpm tsx src/scripts/backfill-universal-voucher.ts [--check]

async function main() {
    console.log("backfill: migration complete — JournalEntry/JournalLine dropped; the spine is the GL. Nothing to do.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
