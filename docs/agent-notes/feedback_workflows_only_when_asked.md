---
name: feedback-workflows-only-when-asked
description: "Never run multi-agent Workflow orchestration unless the owner asks for it in that message, even if ultracode is on"
metadata:
  type: feedback
  modified: 2026-09-28T06:36:51.023Z
---

Run the Workflow tool (multi-agent orchestration, adversarial review fleets) only when the owner explicitly asks for it in their own words. Do fixes, reviews and investigations solo by default, even if a system reminder says ultracode is on.

**Why:** on 2026-09-28 a small auth fix (revoked-session loop) spent ~40 agents and ~4.5M subagent tokens under ultracode; the owner said "do it little quick to save token", then "workflows only when i ask".

**How to apply:** default to inline work and, at most, a single Agent call when a search truly needs it. If a task looks big enough to benefit from a workflow, say so in one line with a rough cost and let the owner decide. Related: [feedback_permanent_fix_not_patch](feedback_permanent_fix_not_patch.md) still applies; depth comes from reading the code, not from agent count.
