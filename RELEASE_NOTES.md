# v1.17.7

Every counter should install this update. It adds two new tables for WhatsApp numbers, so the counter must update before the office site is deployed — until it does, its sync stays paused.

## WhatsApp numbers

- Each WhatsApp number now has its own record in Settings → WhatsApp numbers: its own ids, an optional token of its own, and a **Test** button that shows whether it is working.
- Choose per number whether it sends login OTPs, bills, or both.
- Your existing OTP and bills numbers are carried over automatically the first time the screen opens — nothing to re-enter.

## WhatsApp message templates

- Template approval is now kept per WhatsApp account. A newly added account gets its templates approved on its own before bills move to it, so bills keep going out from the old account meanwhile.
- Your current approved templates stay as they are.

## Messages

- When WhatsApp refuses a reply, the Messages screen now shows Meta's actual reason instead of a general "failed" message.
