---
name: social-post
description: Make social media posts for the shop (Google Business Profile, Facebook, Instagram, WhatsApp Channel / Status) through AbeerSuite's Cowork agent API — each channel's own text, photo shape and time. Use when the owner says "make a post", "schedule a post", "post for tomorrow", "festival greeting post", or runs /social-post.
---

# Social post

Writes one post idea, shaped for every channel, into Campaigns → Queue through
the app's agent API. The app decides what goes live: in **Draft** mode (the
default) staff check and schedule; in **Schedule** mode the times stand and
Google / Facebook / Instagram post by themselves. For wording and timing, follow
the `abeer-tech-social-posts` skill.

## Setup (ask once if missing)

- `ABEERSUITE_URL` — the office site, e.g. `https://office.example.com` (no trailing `/`).
- `COWORK_API_KEY` — the **Cowork** key from Settings → Incoming API.

Never print the key or write it into a file.

## 1. Read the queue and the rules

```bash
curl -sS -H "x-api-key: $COWORK_API_KEY" "$ABEERSUITE_URL/api/agent/posts"
```

Answer: `{ mode, rules, note, channels: [{ value, label, postsByItself, textMax, photosMax, ratio, ratioLabel }], googleTypes, googleButtons, posts: [...] }`.

- `401` → wrong key, or Cowork is off on Settings → Incoming API. Stop and tell the owner.
- `rules` is what the owner typed for posts. **It beats everything else.**
- Look at `posts` before picking a time: no two posts within 2 hours on the same channel.
- Tell the owner the `mode` before you start.

## 2. Make the post

Times are ISO with the India offset, e.g. `2026-10-30T11:00:00+05:30`. Each
channel's `caption` must fit its `textMax`. A channel left out of `variants`
follows the main text and time.

```bash
curl -sS -X POST -H "x-api-key: $COWORK_API_KEY" -H "content-type: application/json" \
  "$ABEERSUITE_URL/api/agent/posts" -d '{
    "caption": "main text",
    "channels": ["GOOGLE_BUSINESS","FACEBOOK","INSTAGRAM","WA_CHANNEL","WA_STATUS"],
    "scheduledAt": "2026-10-30T11:00:00+05:30",
    "link": "/shop",
    "googleType": "UPDATE", "googleButton": "LEARN_MORE",
    "variants": {
      "GOOGLE_BUSINESS": { "caption": "short, 1-2 lines, call to action" },
      "WA_STATUS": { "caption": "very short", "scheduledAt": "2026-10-30T08:00:00+05:30" }
    }
  }'
```

- `hashtags` (top level) go under the text on Instagram feed / reel and Facebook feed / reel only; a channel's own set: `variants.<CHANNEL>.hashtags` (`""` = none there). Best counts: Instagram 3–8 (max 30), IG reel 3–5, Facebook 1–3, FB reel 2–4.
- `link` is a shop page path (`/shop`, `/<product-path>`), never another site.
- `fromProductId` instead of a photo copies that shop product's photo in.
- Send `"status": "DRAFT"` to keep it a draft even in Schedule mode.
- Answer: `{ mode, photoNote, post }`. Keep `post.id`.

## 3. Add the photo, fitted per channel

A link (https) or a file. `fit: true` cuts the main photo to each channel's
shape (Google 4:3, Facebook / WA Channel 1:1, Status 9:16, Instagram 4:5).

```bash
curl -sS -X POST -H "x-api-key: $COWORK_API_KEY" -H "content-type: application/json" \
  "$ABEERSUITE_URL/api/agent/posts/<id>/photos" -d '{"url":"https://…/photo.jpg","fit":true}'

curl -sS -X POST -H "x-api-key: $COWORK_API_KEY" \
  -F file=@photo.jpg -F fit=true "$ABEERSUITE_URL/api/agent/posts/<id>/photos"
```

- A photo made for one channel only: add `channel` (e.g. `-F channel=WA_STATUS`), no `fit`.
- Instagram needs a photo or MP4. Never schedule Instagram without one.
- Only real photos for work done at site — never an AI image presented as real work.

### Frame a photo for one channel (free — the cut is ours)

Look at the photo (`post.photoLinks[key].url`) and say where the important
part is, as fractions across (`x`) and down (`y`), 0–1. The server cuts it in
that channel's shape around that point and makes it the channel's photo.

```bash
curl -sS -X POST -H "x-api-key: $COWORK_API_KEY" -H "content-type: application/json" \
  "$ABEERSUITE_URL/api/agent/posts/<id>/photos/fit" \
  -d '{"channel":"GOOGLE_BUSINESS","focus":{"x":0.42,"y":0.55},"zoom":1.2}'
```

- `zoom` 1 = the biggest frame that fits (default), up to 5 to go in closer.
- Or the exact frame: `"crop":{"x":0.1,"y":0.2,"w":0.6,"h":0.45}`.
- `key` picks which of the post's photos (default the main one).
- `{"fit":"all"}` = the automatic cut for every channel.
- Keep text, faces and the product inside the frame. Google shows exactly 4:3.

### A channel without the main text

Every channel can stand on its own: leave `caption` empty and give each
ticked channel its own `variants.<CHANNEL>.caption`. A channel with neither is
refused.

## 4. Change or remove

`PATCH /api/agent/posts/<id>` (the whole post, as in step 2) and
`DELETE /api/agent/posts/<id>` — only the agent's own posts (`mine: true`),
and only before any channel has them (`409` after).

## 5. Report

For each post: id, time, channels, what each channel says (first line), photo
fitted or not, and whether it is Draft (staff must schedule on Campaigns →
Queue) or Scheduled (goes out by itself).
