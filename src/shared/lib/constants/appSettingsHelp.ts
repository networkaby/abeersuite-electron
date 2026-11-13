/**
 * Settings → App Settings: what each outside service calls our values, where to
 * get them on its site, and the services whose keys can only live in the server's
 * .env (shown as read-only cards). Client-safe plain data — the page and the help
 * tab both read it. Steps written 2026-11-13; providers move menus, so every entry
 * also links the provider's own page.
 */

export const HELP_CHECKED_ON = "13 Nov 2026";

export type ProviderHelp = {
    /** One line: what this service does for us. */
    about: string;
    /** Our box (its .env key) → what the provider calls it on their site. */
    terms: { key: string; theirs: string }[];
    /** Numbered steps on the provider's site. */
    steps: string[];
    /** Where to start. */
    link: { label: string; url: string };
    note?: string;
};

/** A key that cannot be set on App Settings — the card shows only its name and whether it is set. */
export type EnvOnlyKey = { key: string; label: string; /** Sub-heading inside the card; keys sharing one are shown together. */ group?: string };

/** A service whose keys live only in .env / Vercel. With `attachTo`, its keys show as
 *  read-only rows inside that editable card instead of a card of their own. */
export type EnvOnlyProvider = { provider: string; section: string; why: string; keys: EnvOnlyKey[]; attachTo?: string };

export const ENV_ONLY_PROVIDERS: EnvOnlyProvider[] = [
    {
        provider: "Database (Supabase Postgres)",
        section: "Server & security",
        why: "The app needs these to reach the database where App Settings themselves are saved.",
        keys: [
            { key: "DATABASE_URL", label: "Pooled connection (port 6543)" },
            { key: "DIRECT_URL", label: "Direct connection — migrations" },
        ],
    },
    {
        provider: "Sign-in & saved secrets",
        section: "Server & security",
        why: "AUTH_SECRET signs every login; SCRAMBLE_KEY_SECRET unlocks the secrets saved on this page, so it cannot be saved here itself. The super admin is the way in when no staff login works.",
        keys: [
            { key: "AUTH_SECRET", label: "Login signing secret" },
            { key: "SCRAMBLE_KEY_SECRET", label: "Saved-secrets lock" },
            { key: "SUPER_ADMIN_EMAIL", label: "Emergency admin email" },
            { key: "SUPER_ADMIN_PASSWORD", label: "Emergency admin password" },
        ],
    },
    {
        provider: "Supabase (live updates)",
        section: "Server & security",
        why: "Only sends \"something changed\" messages (Broadcast) — never reads the database, so it may be a different Supabase project. Built into the website (NEXT_PUBLIC_), so .env only.",
        keys: [
            { key: "NEXT_PUBLIC_SUPABASE_URL", label: "Project URL" },
            { key: "NEXT_PUBLIC_SUPABASE_ANON_KEY", label: "anon public key" },
        ],
    },
    {
        provider: "Sentry (error reports)",
        section: "Server & security",
        why: "Read while the app starts, before the database is reached.",
        keys: [
            { key: "NEXT_PUBLIC_SENTRY_DSN", label: "Browser DSN" },
            { key: "SENTRY_DSN", label: "Server DSN" },
            { key: "SENTRY_ENVIRONMENT", label: "Environment name" },
        ],
    },
    {
        provider: "Cloudflare (file storage & staff mail)",
        section: "Files & media",
        why: "Both jobs must be in the SAME Cloudflare account: they read the one CLOUDFLARE_ACCOUNT_ID. R2 is used in about 65 places that must answer instantly (every file link), so all of it stays in .env.",
        keys: [
            { key: "CLOUDFLARE_ACCOUNT_ID", label: "Account ID", group: "Shared by both" },
            { key: "R2_ACCESS_KEY_ID", label: "R2 access key ID", group: "File storage (R2) — chat files, post photos, product feed" },
            { key: "R2_SECRET_ACCESS_KEY", label: "R2 secret access key", group: "File storage (R2) — chat files, post photos, product feed" },
            { key: "R2_MESSAGES_BUCKET", label: "Bucket name", group: "File storage (R2) — chat files, post photos, product feed" },
            { key: "CLOUDFLARE_API_TOKEN", label: "API token", group: "Staff mail forwarding (Email Routing)" },
            { key: "CLOUDFLARE_ZONE_ID", label: "Zone ID (networkservice.in)", group: "Staff mail forwarding (Email Routing)" },
        ],
    },
    {
        provider: "Cloudinary (cloud name)",
        section: "Files & media",
        attachTo: "Cloudinary (photos)",
        why: "Built into the website when it is deployed.",
        keys: [{ key: "NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME", label: "Cloud name" }],
    },
    {
        provider: "Firebase (Google sign-in & shop app push)",
        section: "Sign-in & push",
        why: "All five must come from the SAME Firebase project: a Google sign-in is checked against the service account's project. The web keys are built into the website, so everything stays in .env.",
        keys: [
            { key: "NEXT_PUBLIC_FIREBASE_API_KEY", label: "Web API key", group: "Google sign-in (\"Continue with Google\")" },
            { key: "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", label: "Auth domain", group: "Google sign-in (\"Continue with Google\")" },
            { key: "NEXT_PUBLIC_FIREBASE_PROJECT_ID", label: "Project ID", group: "Google sign-in (\"Continue with Google\")" },
            { key: "NEXT_PUBLIC_FIREBASE_APP_ID", label: "App ID", group: "Google sign-in (\"Continue with Google\")" },
            { key: "FIREBASE_SERVICE_ACCOUNT_JSON", label: "Service account (JSON)", group: "Shop app push — also checks every Google sign-in" },
        ],
    },
    {
        provider: "Web push (browsers)",
        section: "Sign-in & push",
        why: "Not Firebase and no account — a key pair we make ourselves. The public half is built into the website, so the private half must stay beside it in .env.",
        keys: [
            { key: "NEXT_PUBLIC_VAPID_PUBLIC_KEY", label: "Public key" },
            { key: "VAPID_PRIVATE_KEY", label: "Private key" },
            { key: "VAPID_SUBJECT", label: "Contact (mailto:)" },
        ],
    },
];

export const ENV_ONLY_KEYS: string[] = ENV_ONLY_PROVIDERS.flatMap((p) => p.keys.map((k) => k.key));

export const PROVIDER_HELP: Record<string, ProviderHelp> = {
    "WhatsApp (Meta Cloud API)": {
        about: "Sends login codes, bills and replies on WhatsApp through Meta's Cloud API.",
        terms: [
            { key: "META_WA_PHONE_NUMBER_ID", theirs: "Phone number ID (not the phone number itself)" },
            { key: "META_WA_BUSINESS_ACCOUNT_ID", theirs: "WhatsApp Business Account ID (WABA ID)" },
            { key: "WA_CONVERSATION_NUMBER_ID", theirs: "Phone number ID of the second number" },
            { key: "WA_CONVERSATION_BUSINESS_ACCOUNT_ID", theirs: "WhatsApp Business Account ID of the second number's business" },
            { key: "META_WA_SIGNUP_CONFIG_ID", theirs: "Configuration ID (Facebook Login for Business → Configurations)" },
            { key: "META_WA_ACCESS_TOKEN", theirs: "System user access token" },
        ],
        steps: [
            "Open business.facebook.com → WhatsApp Manager → Phone numbers. Click a number: its Phone number ID and the WhatsApp Business Account ID are shown there.",
            "Or easier: fill the token first, Save, then press \"Show numbers from Meta\" on the WhatsApp card and pick Number 1 / Number 2 — both ids fill themselves.",
            "Token: Business settings → Users → System users → AbeerSuite system user → Generate new token → pick the loginapi app, expiry Never, permissions whatsapp_business_messaging and whatsapp_business_management.",
            "Same place → Assign assets → WhatsApp accounts → give the system user full control of every WhatsApp account it sends from (also a second business's, if Number 2 lives there).",
            "Configuration ID: developers.facebook.com → loginapi app → Facebook Login for Business → Configurations → the WhatsApp Embedded Signup configuration.",
        ],
        link: { label: "Meta Business Settings", url: "https://business.facebook.com/latest/settings" },
        note: "A token is shown only once. Keep it in Vercel once it works.",
    },
    "WhatsApp login code (OTP template)": {
        about: "The approved Authentication template the login code is sent with.",
        terms: [
            { key: "WA_OTP_TEMPLATE", theirs: "Template name" },
            { key: "WA_OTP_LANG", theirs: "Language code, e.g. en or en_US" },
            { key: "WA_OTP_BUTTON", theirs: "Button type: Copy code / One-tap autofill" },
        ],
        steps: [
            "business.facebook.com → WhatsApp Manager → Message templates → Create template → category Authentication.",
            "Choose Copy code for website logins. Submit; approval is usually quick.",
            "Copy the template's name and language exactly as shown in the list.",
        ],
        link: { label: "WhatsApp Manager — templates", url: "https://business.facebook.com/latest/whatsapp_manager/message_templates" },
    },
    "Meta app (Facebook / Instagram connect)": {
        about: "The shop's own Meta app (loginapi) — Facebook / Instagram posting and WhatsApp Connect use it.",
        terms: [
            { key: "META_APP_ID", theirs: "App ID" },
            { key: "META_APP_SECRET", theirs: "App secret" },
            { key: "FACEBOOK_REDIRECT_URL", theirs: "Valid OAuth Redirect URI" },
        ],
        steps: [
            "developers.facebook.com → My Apps → loginapi → App settings → Basic: App ID is at the top; App secret → Show.",
            "Facebook Login → Settings → Valid OAuth Redirect URIs: add https://<office site>/api/campaigns/facebook/callback. Leave our box blank to use that address.",
        ],
        link: { label: "Meta for Developers — My Apps", url: "https://developers.facebook.com/apps/" },
    },
    "Google Business Profile": {
        about: "Lets the app read reviews, reply and post on the shop's Google listing.",
        terms: [
            { key: "GOOGLE_BUSINESS_CLIENT_ID", theirs: "OAuth 2.0 Client ID (Web application)" },
            { key: "GOOGLE_BUSINESS_CLIENT_SECRET", theirs: "Client secret" },
            { key: "GOOGLE_BUSINESS_REDIRECT_URL", theirs: "Authorized redirect URI" },
        ],
        steps: [
            "console.cloud.google.com → pick the shop's project → APIs & Services → Credentials.",
            "Create credentials → OAuth client ID → Web application (or open the existing one). Copy Client ID and Client secret.",
            "Under Authorized redirect URIs add https://<office site>/api/campaigns/google/callback. Leave our box blank to use that address.",
            "APIs & Services → Library: the Business Profile APIs must be enabled (needs Google's API access approval).",
        ],
        link: { label: "Google Cloud — Credentials", url: "https://console.cloud.google.com/apis/credentials" },
    },
    "Cloudinary (photos)": {
        about: "Stores product, brand, banner and profile photos.",
        terms: [
            { key: "CLOUDINARY_API_KEY", theirs: "API Key" },
            { key: "CLOUDINARY_API_SECRET", theirs: "API Secret" },
            { key: "NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME", theirs: "Cloud name — .env only (built into the website)" },
        ],
        steps: [
            "cloudinary.com → sign in → Settings (gear) → API Keys.",
            "Copy API Key and API Secret (click the eye to show the secret). Generate a new key if none.",
            "The Cloud name on the same page goes in .env as NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME — it must be the same account.",
        ],
        link: { label: "Cloudinary console", url: "https://console.cloudinary.com/settings/api-keys" },
    },
    Shiprocket: {
        about: "Courier rates, booking and tracking for shop orders.",
        terms: [
            { key: "SHIPROCKET_EMAIL", theirs: "API User email" },
            { key: "SHIPROCKET_PASSWORD", theirs: "API User password" },
        ],
        steps: [
            "app.shiprocket.in → Settings → API → Configure → Create an API User.",
            "Use a new email (not your login email) and set a password — those two go here.",
        ],
        link: { label: "Shiprocket — API settings", url: "https://app.shiprocket.in/api-user" },
        note: "The tracking webhook token is set on Settings → Incoming API → Shiprocket.",
    },
    Shipway: {
        about: "A second courier rate aggregator for shop orders.",
        terms: [
            { key: "SHIPWAY_USERNAME", theirs: "Account email (login email)" },
            { key: "SHIPWAY_LICENSE", theirs: "License Key" },
        ],
        steps: ["app.shipway.com → Profile → Manage profile → License Key.", "The account email is the one you sign in to Shipway with."],
        link: { label: "Shipway", url: "https://app.shipway.com/" },
        note: "The tracking webhook token is set on Settings → Incoming API → Shipway.",
    },
    Razorpay: {
        about: "Online card / UPI payment for shop orders.",
        terms: [
            { key: "RAZORPAY_KEY_ID", theirs: "Key Id (rzp_test_… or rzp_live_…)" },
            { key: "RAZORPAY_KEY_SECRET", theirs: "Key Secret" },
            { key: "RAZORPAY_WEBHOOK_SECRET", theirs: "Webhook Secret" },
        ],
        steps: [
            "dashboard.razorpay.com → switch Test / Live mode at the top (the keys differ).",
            "Account & Settings → API Keys → Generate Key (or Regenerate). The Key Secret is shown only once — copy it then.",
            "Match the gateway's TEST / LIVE choice on Settings → Payment Gateways.",
            "Webhook (optional): Account & Settings → Webhooks → Add → URL <site>/api/shop/razorpay/webhook, type any long secret, tick payment.captured. Paste the same secret here.",
        ],
        link: { label: "Razorpay — API keys", url: "https://dashboard.razorpay.com/app/website-app-settings/api-keys" },
    },
    Cashfree: {
        about: "Online payment gateway.",
        terms: [
            { key: "CASHFREE_APP_ID", theirs: "App ID (Client ID)" },
            { key: "CASHFREE_SECRET_KEY", theirs: "Secret Key (Client Secret)" },
        ],
        steps: ["merchant.cashfree.com → Payment Gateway → Developers → API Keys.", "Test and Production keys differ — pick the mode first."],
        link: { label: "Cashfree merchant dashboard", url: "https://merchant.cashfree.com/" },
    },
    PayU: {
        about: "Online payment gateway.",
        terms: [
            { key: "PAYU_MERCHANT_KEY", theirs: "Merchant Key" },
            { key: "PAYU_MERCHANT_SALT", theirs: "Merchant Salt (v2)" },
        ],
        steps: ["dashboard.payu.in → Developers → API Keys (Key and Salt).", "Test and Live differ — switch mode first."],
        link: { label: "PayU dashboard", url: "https://dashboard.payu.in/" },
    },
    "Pine Labs": {
        about: "Plural hosted checkout for shop payments.",
        terms: [
            { key: "PINELABS_CLIENT_ID", theirs: "Client ID" },
            { key: "PINELABS_CLIENT_SECRET", theirs: "Client Secret" },
        ],
        steps: ["Pine Labs (Plural) dashboard → Settings → API Keys.", "UAT (test) and Live keys differ — match the gateway's mode on Settings → Payment Gateways."],
        link: { label: "Pine Labs Plural", url: "https://dashboard.pluralpay.in/" },
    },
    "Resend (email)": {
        about: "Sends login codes, password resets and email reminders.",
        terms: [
            { key: "EMAIL_FROM", theirs: "From address on a verified domain" },
            { key: "RESEND_API_KEY", theirs: "API Key (re_…)" },
        ],
        steps: [
            "resend.com → API Keys → Create API Key (Sending access is enough). Shown once.",
            "Domains: the From address's domain must be Verified there, e.g. Network Service <no-reply@networkservice.in>.",
        ],
        link: { label: "Resend — API keys", url: "https://resend.com/api-keys" },
    },
    "MiniMoth (SMS)": {
        about: "SMS login codes when WhatsApp fails. MiniMoth makes and checks its own code.",
        terms: [{ key: "MINIMOTH_API_KEY", theirs: "Project API key — starts mm_live_… (sent as X-Api-Key)" }],
        steps: [
            "app.minimoth.dev → sign in → Projects → open (or create) the project → copy its API key (mm_live_…).",
            "Keep a balance there — about Rs 0.35 per code, refunded when undelivered.",
            "Nothing else to set: MiniMoth makes, sends and checks its own code (it tries its own WhatsApp first, then SMS).",
        ],
        link: { label: "MiniMoth app", url: "https://app.minimoth.dev/" },
    },
    "HanuOTP (SMS)": {
        about: "SMS login codes when WhatsApp fails; takes turns with MiniMoth.",
        terms: [
            { key: "HANU_OTP_API_KEY", theirs: "API key" },
            { key: "HANU_OTP_TEMPLATE_ID", theirs: "Template ID — \"default\" = HanuOTP's own wording (blank means default too)" },
        ],
        steps: [
            "hanuotp.in → sign in → OTP Service → API Documentation → Generate API Key. Use the \"OTP Without DLT\" service.",
            "Template: leave blank / default. A custom template needs plan OTP 2 or higher.",
            "Keep a balance — about Rs 0.30 per code.",
        ],
        link: { label: "HanuOTP", url: "https://hanuotp.in/" },
    },
    "Database (Supabase Postgres)": {
        about: "The live database.",
        terms: [
            { key: "DATABASE_URL", theirs: "Connection string — Transaction pooler (port 6543)" },
            { key: "DIRECT_URL", theirs: "Connection string — Direct connection (port 5432)" },
        ],
        steps: ["supabase.com → project → Connect (top bar) → ORMs / connection strings.", "Put the database password into both strings. Vercel needs both — migrations use DIRECT_URL."],
        link: { label: "Supabase dashboard", url: "https://supabase.com/dashboard/projects" },
    },
    "Sign-in & saved secrets": {
        about: "Secrets the app makes itself — not from a provider.",
        terms: [
            { key: "AUTH_SECRET", theirs: "Any random text, 32+ characters" },
            { key: "SCRAMBLE_KEY_SECRET", theirs: "Any random text, 16+ characters — never change it once secrets are saved" },
            { key: "SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD", theirs: "Your own choice" },
        ],
        steps: [
            "Make random text, e.g. in a terminal: openssl rand -base64 32.",
            "Same values in Vercel and on every counter. Changing SCRAMBLE_KEY_SECRET makes every saved secret unreadable.",
        ],
        link: { label: "Vercel — Environment Variables", url: "https://vercel.com/dashboard" },
    },
    "Supabase (live updates)": {
        about: "Pushes changes to open screens in real time.",
        terms: [
            { key: "NEXT_PUBLIC_SUPABASE_URL", theirs: "Project URL" },
            { key: "NEXT_PUBLIC_SUPABASE_ANON_KEY", theirs: "anon public key" },
        ],
        steps: ["supabase.com → project → Project Settings → API (Data API): Project URL and the anon public key."],
        link: { label: "Supabase dashboard", url: "https://supabase.com/dashboard/projects" },
    },
    "Sentry (error reports)": {
        about: "Collects app errors.",
        terms: [{ key: "SENTRY_DSN / NEXT_PUBLIC_SENTRY_DSN", theirs: "DSN" }],
        steps: ["sentry.io → Settings → Projects → the project → Client Keys (DSN)."],
        link: { label: "Sentry", url: "https://sentry.io/" },
    },
    "Cloudflare (file storage & staff mail)": {
        about: "One Cloudflare account: R2 private file storage (chat files, post photos, product feed) and Email Routing (name@networkservice.in → each staff member's own inbox).",
        terms: [
            { key: "CLOUDFLARE_ACCOUNT_ID", theirs: "Account ID — used by both" },
            { key: "R2_ACCESS_KEY_ID", theirs: "R2 Access Key ID" },
            { key: "R2_SECRET_ACCESS_KEY", theirs: "R2 Secret Access Key" },
            { key: "R2_MESSAGES_BUCKET", theirs: "R2 bucket name" },
            { key: "CLOUDFLARE_API_TOKEN", theirs: "API Token (Email Routing)" },
            { key: "CLOUDFLARE_ZONE_ID", theirs: "Zone ID of networkservice.in" },
        ],
        steps: [
            "dash.cloudflare.com → R2 Object Storage. The Account ID is on the right of the R2 overview.",
            "R2 → Manage R2 API Tokens → Create API token → Object Read & Write on the bucket. Copy Access Key ID and Secret Access Key (shown once).",
            "The bucket name is the private bucket's name in the R2 list.",
            "Mail: open networkservice.in → Overview — the Zone ID is on the right.",
            "My Profile → API Tokens → Create Token → Custom: Email Routing Rules Edit (zone) + Email Routing Addresses Edit (account).",
        ],
        link: { label: "Cloudflare dashboard", url: "https://dash.cloudflare.com/" },
    },
    "Cloudinary (cloud name)": {
        about: "The Cloudinary account's name, built into the website.",
        terms: [{ key: "NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME", theirs: "Cloud name" }],
        steps: ["cloudinary.com → Dashboard / Settings → API Keys: Cloud name at the top."],
        link: { label: "Cloudinary console", url: "https://console.cloudinary.com/" },
    },
    "Firebase (Google sign-in & shop app push)": {
        about: "One Firebase project, two jobs: the web keys run \"Continue with Google\"; the service account sends push to the shop app and checks each Google sign-in. Mixing two projects makes every Google sign-in fail.",
        terms: [
            { key: "NEXT_PUBLIC_FIREBASE_API_KEY / _AUTH_DOMAIN / _PROJECT_ID / _APP_ID", theirs: "Web app config: apiKey, authDomain, projectId, appId" },
            { key: "FIREBASE_SERVICE_ACCOUNT_JSON", theirs: "Service account private key (JSON file) — same project" },
        ],
        steps: [
            "console.firebase.google.com → the shop's project → Project settings → General → Your apps → the Web app → SDK setup and configuration → Config.",
            "Same project → Project settings → Service accounts → Generate new private key. Paste the whole JSON as one line.",
            "The shop app's google-services.json must come from this same project, or push never arrives.",
        ],
        link: { label: "Firebase console", url: "https://console.firebase.google.com/" },
    },
    "Web push (browsers)": {
        about: "Notifications in browsers and the installed web app, for staff and customers. Not Firebase — a key pair we make.",
        terms: [
            { key: "NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY", theirs: "VAPID key pair (public / private)" },
            { key: "VAPID_SUBJECT", theirs: "mailto:you@yourdomain" },
        ],
        steps: ["Run npx web-push generate-vapid-keys once and keep the pair.", "Changing the pair signs every browser out of notifications."],
        link: { label: "web-push", url: "https://www.npmjs.com/package/web-push" },
    },
    "Dropbox (backup copy)": {
        about: "Keeps a copy of every backup.",
        terms: [
            { key: "DROPBOX_APP_KEY / DROPBOX_APP_SECRET", theirs: "App key / App secret" },
            { key: "DROPBOX_REFRESH_TOKEN", theirs: "Refresh token (offline access)" },
        ],
        steps: ["dropbox.com/developers/apps → the app → Settings: App key and App secret.", "The refresh token comes from one offline-access sign-in — see docs/commands.md."],
        note: "Keep these in .env / Vercel too: if the database is lost, App Settings go with it, and Restore needs these keys to list the backups.",
        link: { label: "Dropbox App Console", url: "https://www.dropbox.com/developers/apps" },
    },
    "GitHub (backup & restore runs)": {
        about: "Starts the backup / restore GitHub Actions.",
        terms: [
            { key: "GITHUB_DISPATCH_TOKEN", theirs: "Fine-grained personal access token (Actions: Read and write)" },
            { key: "GITHUB_REPO", theirs: "owner/repository name" },
            { key: "GITHUB_WORKFLOW_REF", theirs: "Branch name" },
            { key: "GITHUB_BACKUP_WORKFLOW / GITHUB_RESTORE_WORKFLOW", theirs: "Workflow file names in .github/workflows" },
        ],
        note: "Keep these in .env / Vercel too: if the database is lost, App Settings go with it, and Restore needs these keys to run.",
        steps: ["github.com → Settings → Developer settings → Fine-grained tokens → Generate new token → only the backup repository → Actions: Read and write."],
        link: { label: "GitHub — tokens", url: "https://github.com/settings/tokens?type=beta" },
    },
};
