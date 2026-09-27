# v1.8.3

A quiet update. The main addition is **SL Search** — find a sale or repair ticket from a unit's serial number alone — on both the office and the POS. It also tidies up staff profiles and security settings. Counters can take it at their next safe moment — nothing changes in the database, and billing works exactly as before.

## SL Search (new)

- A customer brings a unit back with no bill and cannot remember the name or phone they bought it under? Type or scan the **SL no** and AbeerSuite finds the bill it was sold on — party, date, days since sale and product — plus any repair or help ticket that mentions it.
- In the office: **Sidebar → Workspace → SL Search**. On the POS: the new **SL Search** button on the right-side rail, just under **Lead**.
- Search starts by itself as you type, and at once when a scanner finishes. After a scan the number stays selected, so the next scan simply replaces it.
- Bill no, ticket # and party name are clickable. Right-click opens them in a new window. On the POS they always open in a new tab, so a half-made bill is never lost.
- Purchase, GRN and other supplier-side documents show only to staff who are allowed to see suppliers.
- Admins can show or hide it per role from the Role page.

## Repair tickets

- The **Problem** box now reminds staff to include the unit's SL no, so SL Search can find the ticket later.

## Staff profile and security

- Changing your own password now asks for your current password first.
- Staff can pick their own company email handle, right beside the forwarding setting.
- The Security tab shows the counter PIN first, with the cards side by side.
- Each staff detail now has one home, so different screens can no longer overwrite each other. Job title comes from the HR seat; staff and emergency phone numbers follow one 10-digit rule.
- The sign-in email is changed only from Security (your own) or HR Access (admins). The extra Email box on the profile is gone.

## HR

- A leave request can now be deleted from the Leave board — HR can delete any, staff only their own pending ones. Deleting an approved leave gives the days back.
- The duplicate **My Portal** link is gone from the HR menu — clicking your name in the sidebar opens it.
