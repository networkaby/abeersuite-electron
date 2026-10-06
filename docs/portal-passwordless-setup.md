# Portal passwordless sign-in — setup

Everything in the app is built. What remains is account setup on three consoles
and pasting five values into env. Do them in any order; each unlocks one channel.

| Channel | Needs | Works without setup? |
| --- | --- | --- |
| Mobile OTP (WhatsApp) | Meta WhatsApp Cloud API | no — shows "not set up yet" |
| Email OTP | Resend (or any email vendor) | no — shows "not set up yet" |
| Google | Firebase Google | no — shows "not set up yet" |
| Mobile/email + password | nothing | **yes, works today** |

Password accounts are created and reset at `/portal/register` and
`/portal/forgot-password`. Both verify the mobile/email by OTP first, so at least
one OTP channel above must be set up before a customer can pick a password. That
verification is not optional: the password is linked to an existing customer
record by number, so without it anyone could claim another customer's orders.

The password login keeps working throughout, so the site is never broken while
you set these up.

**How OTP works here:** *we* generate the 6-digit code and decide whether it is
correct. Meta (WhatsApp) and Resend only *deliver* the message — neither vendor is
trusted to say who is authenticated. That is why mobile OTP needs no reCAPTCHA, why
both channels behave identically, and why swapping either vendor touches one
file. Firebase is now used for **Google sign-in only**.

---

## 1. WhatsApp (Meta direct) — unlocks Mobile OTP

Mobile codes go on WhatsApp as an *authentication* template, sent straight
through Meta's Cloud API: **~Rs 0.115 per code, no monthly fee**, and Meta bills
only delivered messages. We generate and verify the code ourselves.

### SMS fallback — HanuOTP or MiniMoth (no DLT of our own)

When WhatsApp cannot deliver (no WhatsApp on the number, template paused), the
code goes by SMS through the provider named in `SMS_OTP_PROVIDER`
(`hanuotp` | `minimoth` | `off`) — `src/shared/lib/sms/sendSms.ts`. Switching
is that one env line plus a restart. A provider counts only when its key is
filled in (blank or the `your-…` placeholder = off); with none, a WhatsApp
failure tells the customer to use email OTP, Google or password.

| | HanuOTP | MiniMoth |
|---|---|---|
| Key | `HANU_OTP_API_KEY` (+ optional `HANU_OTP_TEMPLATE_ID`, default `default`) | `MINIMOTH_API_KEY` (`mm_live_…`, app.minimoth.dev > Projects) |
| Price | Rs 0.30 on plan OTP 1 (Rs 100, 335 codes, no recharge; next plan Rs 3,600) | Rs 0.35, Rs 50 minimum top-up, refunded if undelivered |
| Who makes the code | We do; HanuOTP only delivers | MiniMoth makes and checks it — the pending cookie stores `remote:minimoth` instead of a hash and verify asks their `/v1/otp/verify` |

Automatic fallback only happens when Meta *refuses* the send. A phone with no
internet still has WhatsApp, so Meta accepts and holds the message — no SMS.
For that case the code screen shows **"No internet on your phone? Send by SMS
instead"** once the 30 s resend wait ends (only when an SMS provider is on);
it posts `via: "sms"` to the send route, which skips WhatsApp, and a later
"Resend code" stays on SMS. Same per-number send throttle.

HanuOTP replies HTTP 200 even on errors (`{"status":"error",...}`), so the body
is checked too. MiniMoth tries its own WhatsApp before SMS, but we only call it
after Meta WhatsApp has failed. Fast2SMS was removed on 2026-10-06: without our
own DLT its only route cost ~Rs 5 per SMS.

### Setup

1. **Meta app.** Go to <https://developers.facebook.com> → *My Apps* → *Create App*
   → type **Business** → add the **WhatsApp** product. Free; no BSP, no monthly fee.
2. **Business verification.** In *Meta Business Suite → Business settings →
   Security Centre*, complete verification for the business. Until this is done
   you are stuck on a test number that only messages 5 pre-registered recipients.
3. **Sending number.** *WhatsApp → API Setup* → *Add phone number*, verify it by
   OTP. Use a number that is **not** on the WhatsApp Business app — OTP traffic is
   high-frequency and can drag a number's quality rating down.
   That screen also shows the **Phone number ID** → `META_WA_PHONE_NUMBER_ID`.
   (It is a long number, *not* the phone number itself.)
4. **Template.** *WhatsApp Manager → Message templates → Create template* →
   category **Authentication**. Meta writes the body for you; the code is the only
   variable. Two things on this screen decide your env values, so note them:
   - the **language** you pick — usually `English (US)` = `en_US`, **not** `en`;
   - whether you leave **"Copy code"** ticked (it is on by default).

   Wait for approval — usually under a day.
5. **Permanent token.** *Business settings → Users → System users* → add a system
   user with the Admin role → *Generate new token* → pick your app → tick
   `whatsapp_business_messaging` **and** `whatsapp_business_management` → set
   expiry **Never**. → `META_WA_ACCESS_TOKEN`.
   The token shown on the API Setup page is a **24-hour dev token** — never ship it.
6. **Env.** Set `META_WA_ACCESS_TOKEN`, `META_WA_PHONE_NUMBER_ID`,
   `WA_OTP_TEMPLATE` (the template **name**, e.g. `signin_code`, not its id),
   and then the two that decide whether it actually delivers:

   | Your template | `WA_OTP_LANG` | `WA_OTP_BUTTON` |
   | --- | --- | --- |
   | English (US) + "Copy code" ticked *(the default)* | `en_US` | `copy_code` |
   | English + "Copy code" ticked | `en` | `copy_code` |
   | Copy code un-ticked, body only | match the language | leave unset |
   | Made for an Android app (one-tap autofill) | match the language | `one_tap` |

> **These two are the whole game.** Get either wrong and Meta rejects every
> single send, and every customer who types a mobile is told to use email or
> Google instead. Check `WhatsApp OTP failed` in the server logs.

**Test it before trusting it.** With the env set, request a code on `/login` with
a real mobile and watch the server log. Silence means WhatsApp delivered; a
`WhatsApp send failed (...)` line carries Meta's own reason —
`template name does not exist in the translation` is the language mismatch,
`number of parameters does not match` is the button mismatch.

Sender lives in `src/shared/lib/whatsapp/sendWhatsApp.ts`; the pick-a-pipe
decision is `sendMobileOtp()` in `src/app/api/portal/otp/send/route.ts`.

## 2. Firebase — unlocks Google sign-in only

1. Go to <https://console.firebase.google.com> → **Add project** (or pick an existing one).
2. Inside the project: **Build → Authentication → Get started**.
3. **Sign-in method** tab → enable **Google**. It asks for a support email; pick yours.
   (You do **not** need to enable Phone — mobile codes go on WhatsApp.)
4. **Settings → Authorized domains** → add every domain the login page is served from:
   - `localhost` (usually already there)
   - your production domain, e.g. `networkservice.in`
   - your Vercel preview domain, e.g. `your-app.vercel.app`
   - **If a domain is missing, sign-in fails on that domain only** — this is the
     single most common cause of "it works locally but not live".
6. **Project settings (gear) → General → Your apps → Web app (`</>`)**. Register one
   if none exists. Copy these three from the config snippet shown:
   - `apiKey`
   - `authDomain`
   - `projectId`
   - `appId`
7. **Project settings → Service accounts → Generate new private key**. A `.json`
   file downloads. This is the server-side credential.

> The web `apiKey` is *not* a secret — it ships to the browser by design and is
> safe to expose. The service-account JSON **is** a secret: never commit it.

## 3. Resend — unlocks Email OTP

Firebase cannot send a 6-digit email code (it only sends sign-in *links*, which we
deliberately do not use), so email codes go through a normal email vendor.

1. Sign up at <https://resend.com> → **API Keys → Create API Key** (sending permission).
2. **Domains → Add Domain**, then add the DNS records it shows you at your registrar.
   Until the domain is verified you can only send to your own address.
3. Your `EMAIL_FROM` must be an address on that verified domain,
   e.g. `Network Service <no-reply@networkservice.in>`.

Prefer a different provider? Only `deliver()` in
`src/shared/lib/email/sendEmail.ts` needs rewriting — nothing else calls the vendor.

## 4. Environment variables

Add to `.env.local` for development:

```bash
# WhatsApp OTP, direct to Meta (~Rs 0.115/msg, no markup, no monthly fee)
# META_WA_ACCESS_TOKEN=EAA...          # permanent System User token
# META_WA_PHONE_NUMBER_ID=your-phone-number-id
# WA_OTP_TEMPLATE=your_auth_template_name
# WA_OTP_LANG=en_US
# WA_OTP_BUTTON=copy_code

# Firebase — browser (safe to expose). Google sign-in only.
NEXT_PUBLIC_FIREBASE_API_KEY=AIza...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project
NEXT_PUBLIC_FIREBASE_APP_ID=1:123456789:web:abc123

# Firebase — server (SECRET). The whole service-account .json on ONE line.
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n","client_email":"...@....iam.gserviceaccount.com"}

# Email OTP (SECRET)
RESEND_API_KEY=re_...
EMAIL_FROM=Network Service <no-reply@yourdomain.com>
```

Getting `FIREBASE_SERVICE_ACCOUNT_JSON` onto one line — run this on the downloaded file:

```bash
node -e "console.log(JSON.stringify(require('fs').readFileSync(process.argv[1],'utf8')))" path/to/service-account.json
```

Paste the result **without** the outer quotes it prints. The `\n` inside
`private_key` must stay as the two characters `\` and `n` — the code converts them
back to real newlines. Do not reformat or pretty-print the JSON.

`AUTH_SECRET` must also be set (it already is — it signs the email-OTP cookies too).

For production, add the same five variables in **Vercel → Project → Settings →
Environment Variables**, then redeploy. Never commit any of them.

## 5. Verifying it works

After setting the env vars, restart the dev server (env is read at boot).

- **Mobile OTP** — enter your real mobile on `/login`, press *Send code*. If nothing
  arrives, the server log's `WhatsApp send failed (...)` line carries Meta's own
  reason; the customer only ever sees a generic message.
- **Email OTP** — enter your email, press *Send code*, check the inbox.
- **Google** — press *Google*; a popup appears. If it does not, your browser blocked
  popups (the page tells the customer this).

Everything except vendor delivery is already proven working: the send → verify →
ticket → sign-in round trip was tested end-to-end against the live routes, so if a
code reaches the customer, the rest works.

## 6. Things worth knowing

- **A first-time customer is not rejected.** Any verified mobile/email we have never
  seen shows a small form asking only for a name, then creates the customer with a
  cash-only account (`creditLimit: 0`) — same as self-registration.
- **OTP customers have no password.** They cannot use the Password tab until they set
  one from inside the portal. This is intentional; nothing stores a fake password.
- **Rate limits.** 5 sends per identifier per 15 minutes (mobile *and* email), and 5
  wrong guesses kills a code. The send throttle is your WhatsApp spend guard — Meta
  bills per delivered message, so do not loosen it without thinking about abuse.
- **No database change was needed.** The pending email code lives in a signed,
  httpOnly cookie rather than a table, so there is no schema push and nothing to
  clean up. Only the code's *hash* is ever stored.
- **Remove `?uiPreview=code|onboard`** from `src/app/(external)/login/page.tsx` once
  you are happy — it is a visual-review aid, harmless but no longer needed.
