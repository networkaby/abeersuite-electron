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

Network Service, Abhayapuri — computers, laptops, CCTV, printers, A4 paper,
accessories and repairs. Sound like the shop owner talking to a customer in
Assam, not a company advert.

```
Thank you, <Name + honorific>! <One or two lines that answer what they actually said.> <Closing line>

— Team Network Service
```

### Tone — local English of Assam

| Avoid | Prefer |
| --- | --- |
| We are delighted to learn of your satisfaction. | Happy to know you are satisfied. |
| We endeavour to provide exceptional assistance. | We always try to give proper support. |
| We appreciate your valuable patronage. | Thank you for your support. |
| We look forward to serving you in the future. | Hope to see you again soon. |

### Name and honorific — match the customer's tone

- Write the name in Title Case (`uttamkumar sarkar` → `Uttamkumar Sarkar`); keep a nickname as it is (`STONER 69`). Use the full name the customer shows — never cut it (`STORY STÃTÛS`, not `STORY ST`). No name → "Thank you for your …".
- No strict rule — the address should feel natural for Assam and **match how the review is written**:

| Review tone | Address | Reply style |
| --- | --- | --- |
| Formal, detailed, polite English | Name + `ji` / `sahab`, or the full name (`Ritendra ji`, `Nabir sahab`, `Dear Bedanti Sarma`) | Formal, respectful, no jokes |
| Normal, short, friendly | `da` / `dada`, `bhai`, `baideu`, `didi`, `bubu`, or `ji` (`Raju da`, `Jakir bhai`, `Mira baideu`) | Warm, simple |
| Light or funny (emojis, slang, typos like "god service") | Friendly — `bhai`, `da`, even a light word if the review sets that tone | Can be playful, never mocking |

- In Assam `da`, `baideu` and `ji` are used for anyone, Muslim or not; `bhai`, `bubu` and `sahab` fit Muslim names naturally. Vary between them across replies so they don't all read the same.
- Gender must be clear before a gendered word (`da`, `bhai`, `baideu`, `bubu`, `didi`, `sahab`). Gender-neutral name (Mukuta, Jyoti), nickname, initials, business name, or any doubt → `Dear <Name>` or the name alone.
- Never a casual word (`boss`, `bro`) on a formal review, and never joke about a 1–3★ review or the customer's spelling.
- Show the address in the preview table so the owner can change it.

### Length

- Stars only: 15–30 words. One-line comment: 20–40 words. Detailed comment: 35–60 words.
- Complaint: as long as a sincere, practical reply needs. Always under 600 characters.

### Match the review

| Review | Approach |
| --- | --- |
| 4–5★, stars only | Brief thanks, no product claims |
| Product / brand named | Mention that product or brand |
| Repair | Acknowledge the repair work |
| Price | Mention fair price / value |
| After-sales | Thank them for their trust |
| Photo shared | Thank them; mention the photo only if natural |
| Local Guide | Acknowledge, no heavy flattery |
| 4★ | Thank them, show we want to improve |
| 3★ | Thank them, ask what we could do better |
| 1–2★ | Say sorry first, no excuses, no arguing, never blame the customer; offer a practical way to fix it (call or visit). No refund or free-service promises |
| Typo / unclear | Answer the likely meaning only when reasonably clear |

Never invent a detail the customer did not write.

### Local SEO — support, not the purpose

Pick at most one or two keywords, only when they fit the review:

- **CCTV**: CP PLUS CCTV, CCTV installation, security camera setup, DVR support, CCTV after-sales service.
- **Computers**: computer accessories, desktop computers, laptop repairing, genuine computer parts, office computer setup.
- **Printers & supplies**: printer sales and service, A4 paper, printing supplies, printer accessories.
- **Location**: Abhayapuri, Bongaigaon district, Network Service — sometimes, not every reply; often none.

Rotation rules:

1. Not "Bongaigaon district" in every reply; not "CP PLUS CCTV" unless the review fits.
2. Vary openings and closings — no fixed closing line, no sentence pasted across replies.
3. Sometimes a product keyword, sometimes a service keyword, sometimes none.
4. Never claim "authorised dealer"; never promise a product, warranty or installation the review does not support.
5. One emoji at most. No hashtags, links, prices, or phone numbers unless `rules` gives one.

### Checklist before showing

Correct name spelling · honorific only when confident · natural Assam English ·
matches the review and stars · keyword only if it fits · varied wording ·
short and ready to send · no invented claims or forced SEO.

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
