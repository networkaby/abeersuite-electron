---
name: feedback-no-forced-dry-across-print-formats
description: "Print renderers stay separate per format / printer type / page size; never merge A4, thermal HTML, ESC/POS or label layouts into shared code"
metadata: 
  type: feedback
  modified: 2026-09-06T17:52:27.163Z
---

Keep each print output's layout code separate: A4 HTML, thermal 80mm HTML, thermal ESC/POS (hardware-bridge/thermal.js), and each label size. Share only template *data* (VoucherTemplateDefaults, resolveTemplateForFormat), never layout or alignment code across formats. New formats (A5, 58mm) get their own renderer.

**Why:** Owner said on 2026-09-06, while approving the print-consistency plan: "dont mix templets, keep format / printer type / page size wise separate … dont forced DRY it can break the format or alignment." Thermal column widths and A4 boxes have broken before when shared.

**How to apply:** When fixing a print bug, fix it inside that format's renderer. Helpers inside one renderer file (e.g. printHeader/printFooter within thermal.js, same 80mm ESC/POS) are fine; a helper imported by two different formats is not. Related: [project_release_means_full_checklist](project_release_means_full_checklist.md) (bridge changes need a counter build).
