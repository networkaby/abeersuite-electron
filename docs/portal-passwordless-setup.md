# Portal passwordless sign-in — setup

Everything in the app is built. What remains is account setup on three consoles
and pasting five values into env. Do them in any order; each unlocks one channel.

| Channel | Needs | Works without setup? |
| --- | --- | --- |
| Mobile OTP (WhatsApp, falls back to SMS) | Fast2SMS | no — shows "not set up yet" |
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
correct. Fast2SMS and Resend only *deliver* the message — neither vendor is
trusted to say who is authenticated. That is why SMS needs no reCAPTCHA, why
both channels behave identically, and why swapping either vendor touches one
file. Firebase is now used for **Google sign-in only**.

---

## 1. Fast2SMS — unlocks Mobile OTP

India's TRAI rules normally require **DLT registration** for commercial SMS, which
needs a registered entity, PAN/GST and days of approval. **We do not use it.**
Fast2SMS sells routes that send under *their* registration instead, via a random
numeric sender ID, to both DND and non-DND numbers.

Pick a route with `FAST2SMS_ROUTE`:

| `FAST2SMS_ROUTE` | DLT needed | Template needed | Cost | Use when |
| --- | --- | --- | --- | --- |
| `q` *(default)* | no | no | **~Rs 5 per SMS** | starting out, low volume |
| `otp` | no | yes — set up in the Fast2SMS dashboard | plan rate (much cheaper) | volume grows |

Steps:

1. Sign up at <https://www.fast2sms.com> and add wallet balance (SMS is prepaid).
2. **Dev API → API Key** — copy it into `FAST2SMS_API_KEY`.
3. That is enough to go live on the default `q` route.
4. When volume justifies it, create an OTP template in the dashboard, put its ID in
   `FAST2SMS_OTP_TEMPLATE_ID`, and set `FAST2SMS_ROUTE=otp`. No code change.

> **Watch the cost on `q`.** At ~Rs 5 per SMS, the 5-sends-per-identifier-per-15-min
> throttle is your spend guard — do not loosen it. Email OTP and Google cost nothing
> per sign-in, so most customers should never trigger an SMS.

The message we send is 91 characters — one SMS segment, so one charge:
`123456 is your Network Service sign-in code. Valid 10 minutes. Do not share it with anyone.`

Prefer MSG91/Twilio/Gupshup? Only `sendOtpSms()` in
`src/shared/lib/sms/sendSms.ts` needs rewriting — verification is ours, so no other
file cares how the code was delivered.

### 1b. WhatsApp — the cheaper pipe for the same mobile OTP

A WhatsApp *authentication* template costs a fraction of an SMS, so once it is
set up mobile codes go over WhatsApp and **fall back to SMS automatically** if
WhatsApp cannot deliver. Nothing else in the flow changes: we still generate and
verify the code ourselves.

**Cost per mobile code — pick the transport deliberately:**

| Transport | Rate | Monthly fee |
| --- | --- | --- |
| **Meta Cloud API, direct** | **~Rs 0.115** per authentication message | **none** |
| Fast2SMS WhatsApp passthrough | Meta's rate + BSP markup | none |
| Fast2SMS SMS | ~Rs 0.30 | none |

Meta bills **only for delivered messages** — a failed send is free. Going direct
means you are Meta's own customer, which removes the reseller markup; the code
supports both and picks direct whenever `META_WA_ACCESS_TOKEN` is set.

#### Option A — direct to Meta (cheapest, recommended)

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
> single send — and because we fall back to SMS on failure, sign-in keeps
> *working* while quietly costing ~Rs 5 a code instead of ~Rs 0.115. Nothing
> looks broken. Check `WhatsApp OTP failed, falling back to SMS` in the server
> logs if the bill looks wrong.

**Test it before trusting it.** With the env set, request a code on `/login` with
a real mobile and watch the server log. Silence means WhatsApp delivered; a
`WhatsApp send failed via Meta direct (...)` line carries Meta's own reason —
`template name does not exist in the translation` is the language mismatch,
`number of parameters does not match` is the button mismatch.

#### Option B — Fast2SMS passthrough (fastest to set up)

Reuses `FAST2SMS_API_KEY`, so there is nothing new to sign up for — but you pay
Fast2SMS's markup over Meta's rate. Steps:

1. In the Fast2SMS dashboard, complete the **WhatsApp / WABA onboarding** (Meta
   embedded signup). It asks for a phone number.
   - **Coexistence:** Meta now lets one number run the WhatsApp Business *app*
     and the API together, so you can keep chatting from your phone. The
     trade-off it states on screen is that contacts, chats and chat history get
     shared with the provider.
   - **Recommended instead:** use a **separate number** for OTP. Automated
     high-frequency traffic can drag the number's quality rating down, and on a
     shared number that also hits your everyday WhatsApp.
2. Create an **AUTHENTICATION** category template and wait for Meta approval
   (usually under a day). The body text is Meta's fixed boilerplate — the code is
   the only variable, so there is nothing to word.
3. Fetch your ids:
   `GET https://www.fast2sms.com/dev/dlt_manager/whatsapp?type=number` gives the
   **phone number id**; `?type=template` lists approved templates. Send the API
   key in the `Authorization` header.
4. Fill the env vars below. No code change.

| Variable | What it is |
| --- | --- |
| `META_WA_ACCESS_TOKEN` | permanent System User token → **enables direct mode** |
| `META_WA_PHONE_NUMBER_ID` | phone number id from the Meta app dashboard |
| `FAST2SMS_WA_PHONE_NUMBER_ID` | passthrough only — from `?type=number` |
| `WA_OTP_TEMPLATE` | the approved template **name** |
| `WA_OTP_LANG` | template language **exactly as approved** — usually `en_US`; default `en` |
| `WA_OTP_BUTTON` | `copy_code` (Meta's default button), `one_tap`, or unset for body-only |

The older `FAST2SMS_WA_OTP_TEMPLATE` / `_LANG` / `_BUTTON` names still work, so an
existing setup keeps running; the `WA_*` names are preferred because the template
settings are the same whichever transport sends them.

Leave both phone-number-id vars unset and everything stays on SMS.
Sender lives in `src/shared/lib/whatsapp/sendWhatsApp.ts`; the pick-a-pipe
decision is `sendMobileOtp()` in `src/app/api/portal/otp/send/route.ts`.

## 2. Firebase — unlocks Google sign-in only

1. Go to <https://console.firebase.google.com> → **Add project** (or pick an existing one).
2. Inside the project: **Build → Authentication → Get started**.
3. **Sign-in method** tab → enable **Google**. It asks for a support email; pick yours.
   (You do **not** need to enable Phone — SMS goes through Fast2SMS.)
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
# SMS OTP via Fast2SMS (SECRET)
FAST2SMS_API_KEY=your-fast2sms-api-key
# Route: "q" = no DLT, no template, ~Rs 5/SMS (default if unset)
#        "otp" = no DLT, needs a dashboard template, much cheaper
FAST2SMS_ROUTE=q
# Only needed when FAST2SMS_ROUTE=otp
# FAST2SMS_OTP_TEMPLATE_ID=your-template-id

# WhatsApp OTP — cheaper than SMS; SMS stays the automatic fallback.
# Unset both phone-number-id vars to stay on SMS only.
#
# Option A: direct to Meta (~Rs 0.115/msg, no markup, no monthly fee)
# META_WA_ACCESS_TOKEN=EAA...          # permanent System User token
# META_WA_PHONE_NUMBER_ID=your-phone-number-id
#
# Option B: Fast2SMS passthrough (reuses FAST2SMS_API_KEY, but marked up)
# FAST2SMS_WA_PHONE_NUMBER_ID=your-phone-number-id
#
# Template settings — same either way
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
  arrives, check in this order: wallet balance, then (only on `FAST2SMS_ROUTE=otp`)
  that the template ID matches. The server log carries Fast2SMS's own reason,
  including which route was used; the customer only ever sees a generic message.
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
- **Rate limits.** 5 sends per identifier per 15 minutes (SMS *and* email), and 5
  wrong guesses kills a code. The send throttle is your SMS spend guard — Fast2SMS
  bills per message, so do not loosen it without thinking about abuse.
- **No database change was needed.** The pending email code lives in a signed,
  httpOnly cookie rather than a table, so there is no schema push and nothing to
  clean up. Only the code's *hash* is ever stored.
- **Remove `?uiPreview=code|onboard`** from `src/app/(external)/login/page.tsx` once
  you are happy — it is a visual-review aid, harmless but no longer needed.
