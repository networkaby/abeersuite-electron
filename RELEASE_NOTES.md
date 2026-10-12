# v1.16.3

Install this when the counter is quiet. It improves WhatsApp conversations and customer follow-up, and makes ledger balances always match the books. It will not interrupt a sale. This version adds a small database change for WhatsApp conversations, so update the counters first. Until a counter updates, its sync will pause.

## WhatsApp messages
- **Conversations now decide the topic.** The customer sees the menu once. After that, follow-up messages stay on the same topic. Staff can close a conversation, and a "/new" message or 2 hours of quiet starts a new one.
- **Old messages are sorted into conversations too**, with a divider where a new conversation begins.
- **A customer message now waits like a missed call.** Any contact can answer calls and messages alike.
- **A plain menu pick no longer lands in the ticket history.**
- **Customer care number on every template.** Each template has a footer, a "Call us" button and a help line.
- **"Open in app" button on bill messages.** The staff app opens the link if it is installed. Otherwise the download page opens.

## Customer follow-up (Reconnect)
- **New Messages filter in Reconnect.** Calls and messages both count as activity.
- **Unsaved WhatsApp numbers are listed and can be searched.**
- **The open customer's timeline reloads by itself** when something new arrives.

## Accountancy
- **Ledger list and top bar show balances summed from the books**, and update live after sync.
- **Bank Book now includes Bank OD**, shows the Available balance in the grand total, and the Dr/Cr sign mismatch is fixed.
- **Ledger dialogs list every group**, even while the Ledgers page is searched.
- **Bank statement matches now sync to the counters.**

## Customers, HR and counter
- **Same-day vouchers are ordered correctly** in the customer ledger, and the running balance reads properly.
- **Staff IDs are generated in sequence** (EMP-786 onwards). Roles and reporting line come from position seats.
- **A salary revision now shows up on other devices.**
- **Counter install fix.** The app no longer tries to write its page cache into the read-only install folder.
- **Every office and voucher screen now follows changes** from the replica without a refresh.
- **The installer cleans up old shortcuts** when a counter updates.

## Database change
This release adds a table and a column for WhatsApp conversations. Update the counters first. Their sync pauses until they have the new version.
