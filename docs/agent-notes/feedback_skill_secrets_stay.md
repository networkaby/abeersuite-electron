---
name: feedback-skill-secrets-stay
description: Owner keeps real API key + URL inside skill files on purpose; do not replace with placeholders or flag it
metadata:
  type: feedback
  modified: 2026-11-11T08:52:13.012Z
---

The product-copy skill (both .claude and .agents copies) holds the real office URL and API key in its Setup lines. Owner said 2026-11-11: keep it — repo is private, they rotate keys often, their own risk.

**Why:** owner's deliberate convenience trade-off.
**How to apply:** never swap skill secrets for placeholders and do not report them as an issue again.
