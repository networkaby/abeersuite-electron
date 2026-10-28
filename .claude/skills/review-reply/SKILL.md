---
name: review-reply
description: Write and send the shop's replies to Google reviews through AbeerSuite's Cowork agent API. Use when the owner says "reply to reviews", "answer the Google reviews", "any new reviews?", "draft review replies", or runs /review-reply.
---

# Review reply

Answers Google reviews that have no reply yet, in Network Service's voice, through
the app's agent API. The app decides what goes live: the agent only writes.

## Setup (ask once if missing)

- `ABEERSUITE_URL` — the office site, e.g. `https://office.example.com` (no trailing `/`).
- `COWORK_API_KEY` — the **Cowork** key from Settings → Incoming API.

If either env var is missing, ask the owner for it. Never print the key back or
write it into a file.

## 1. Fetch

```bash
curl -sS -H "x-api-key: $COWORK_API_KEY" "$ABEERSUITE_URL/api/agent/reviews?replied=no&limit=50"
```

Answer: `{ replyMode, rules, note, reviews: [{ id, reviewerName, stars, comment, reviewedAt, draftText, ... }] }`.

- `401` → the key is wrong, or Cowork is switched off on Settings → Incoming API. Stop and tell the owner.
- Skip every review whose `draftText` is set — staff already have a draft waiting.
- Nothing left → say "No reviews waiting" and stop.
- `rules` is what the owner typed on Settings → Incoming API. **It beats everything below.**

## 2. Write each reply

House style (from the replies already live):

```
Thank you, <Name>, for your <n>⭐ rating<and kind feedback, if they wrote a comment>. <One or two lines that answer what they actually said.> <Closing line>

— Team Network Service
```

- **Name**: write it in Title Case (`uttamkumar sarkar` → `Uttamkumar Sarkar`). Keep a nickname as it is (`STONER 69`). No name → "Thank you for your …".
- **Answer the comment**: if they name a product, a staff member or a service (repair, CCTV, printer, laptop), mention it. Never invent a detail they did not write.
- **Stars only, no comment**: keep it to 2 short lines.
- **4–5★**: warm thanks + "Visit us again anytime!".
- **3★**: thank them, ask what we could do better.
- **1–2★**: say sorry first, no excuses, no arguing, never blame the customer; invite them to call or visit so we can fix it. No refund or free-service promises.
- Plain, friendly English. One emoji at most (the ⭐). No hashtags, no links, no prices, no phone numbers unless `rules` gives one.
- Each reply different — do not paste the same sentence into every review.
- Under 600 characters.

## 3. Show, then send

Show the owner a short table: reviewer, stars, comment, your reply. Wait for "ok"
(or edits) before sending — the reply is public on Google. If the owner said
"send directly" / "don't ask", skip the wait.

```bash
curl -sS -X POST -H "x-api-key: $COWORK_API_KEY" -H "Content-Type: application/json" \
  -d '{"text":"<reply>"}' "$ABEERSUITE_URL/api/agent/reviews/<id>/reply"
```

Build the JSON with `jq -n --arg text "$REPLY" '{text:$text}'` so quotes and new lines are escaped.
Add `"mode":"draft"` when unsure about a reply — it lands on CRM → Reviews for staff.

Answer: `{ "result": "posted" }` or `{ "result": "draft", "reason": "..." }`.
A draft is normal: 1–2★ always go to draft, and so does everything when the
mode on Settings → Incoming API is Draft. `502` = Google refused; report it,
carry on with the rest.

## 4. Report

One line per review: name, stars, **posted** / **draft (reason)** / **failed (error)**.
If any went to draft, remind the owner to check them on CRM → Reviews → Drafts.
