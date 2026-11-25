---
name: feedback_autofill_manual_override
description: "Any auto-fill from an outside lookup (IFSC, pincode…) must leave what staff typed alone and never block a save"
metadata:
  type: feedback
  modified: 2026-09-29T11:35:00.844Z
---

Owner asked for the IFSC → branch lookup with "for wrong information manual override" (2026-09-29).

**Why:** outside lists (RBI's IFSC list via Razorpay, India Post pincodes) can be stale or wrong, and staff know the real branch.

**How to apply:** an external lookup fills only blank boxes (or ones still holding its own earlier fill), only after the user types the key field, never on opening a saved record. Show the looked-up value as a hint with a "Use" button, and never make "not found" block a save. Pattern lives in `src/shared/hooks/useIfscLookup.ts` — reuse it for the next lookup.
