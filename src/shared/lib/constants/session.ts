/**
 * Sign-in clocks — how long a login lasts, when an idle login ends, and how far the
 * customer OTP is trusted.
 *
 *   • SIGN OUT AFTER (45 min, per person — "Sign out after" on HR → Job) — no click
 *     or key for this long and the person is signed out; on a counter their 4-digit
 *     PIN signs them back in. Also where duty time stops counting.
 *   • LOGIN LIFETIME (10 days / 3 days) — the only things that end a login on their
 *     own: 10 days since the password was typed, or 3 days with nobody using it.
 *     The same two clocks decide when a counter PIN may sign somebody in instead of
 *     the password (`counterPin.ts`, owner 2026-10-15).
 *     Owner, 2026-10-13: "this is the auto full logout condition, otherwise lock is
 *     enough." It replaced a 6-hour lifetime that signed every till out each night.
 */

// ─── Login lifetime ──────────────────────────────────────────────────────────
// Both halves need these and they live on opposite sides: `src/auth.ts` enforces
// them, and the screen that has just been signed out has to be able to SAY it.

/** Type the password again this long after last typing it. Checked against the
 *  token's `loginAt` on every request (`isStaffTokenRevoked`), so it holds however
 *  busy the login has been. */
export const LOGIN_MAX_AGE_MS = 10 * 24 * 60 * 60 * 1000;

/** A login nobody has used for this long ends. It is the cookie's own rolling
 *  lifetime, so it covers a machine with the app shut — and the counter lock checks
 *  it too, because a locked till keeps polling and would otherwise roll it forever. */
export const LOGIN_IDLE_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

/** The idle span in words, for the line shown to whoever was just signed out. */
export const LOGIN_IDLE_LABEL = `${LOGIN_IDLE_MAX_AGE_MS / (24 * 60 * 60 * 1000)} days`;

/** Re-issue the login cookie at most this often (seconds). It used to be every
 *  request, and a request still in flight at Sign out put a fresh cookie back — the
 *  till signed itself in again. The 3-day idle clock above still rolls with use; it
 *  just moves in 5-minute steps. */
export const SESSION_RENEW_EVERY_S = 5 * 60;

/** A till renews its counter key (the office sign-in for the v_live relay,
 *  counter/relayKey.ts) this often. The key never expires on its own — only an
 *  admin's revoke ends it; renewal just limits how long a copied key stays useful. */
export const COUNTER_KEY_RENEW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * What a person is told when their login was ended from elsewhere (`SESSION_REVOKED`).
 * Named for both causes because the server cannot tell which one it was: an admin
 * changed their role, position or permissions, or they signed out on another device —
 * a sign-out ends every login of that person. Saying "an admin" to somebody who just
 * signed out of the office website sent them looking for an admin who did nothing.
 * The API answer and the browser's notice share it, so the two can never disagree.
 */
export const SESSION_REVOKED_MESSAGE =
    "You were signed out — your access changed, or you signed out on another device. Please sign in again.";

/**
 * The code a staff password sign-in fails with when the password was right but this
 * is not a counter and the person lacks "Can login outside counter"
 * (`authorizeStaffCredentials`). The server throws it and the login page reads it
 * from `signIn()`'s result, so both sides share the one string.
 */
export const OUTSIDE_COUNTER_SIGNIN_CODE = "outside-counter";

// ─── Sign out after (idle) ───────────────────────────────────────────────────

/**
 * No click, no keypress, no touch for this long → signed out, and the stretch is
 * not counted as duty. A person's own limit (StaffProfile.idleLimitMinutes, HR →
 * Job tab) overrides it — see `idleLimitMinutesFor` in `hr/dutyTime.ts`.
 *
 * 45 minutes is a judgement, and the trade is real in both directions. Shorter and
 * a cashier standing at a quiet counter on a slow afternoon gets logged out while
 * genuinely at work, and docked for it. Longer and a real absence is paid. 45 is
 * above any plausible gap between customers and below a tea break, and the person
 * is warned before it fires (see IDLE_WARNING_MS) so it never arrives as a shock.
 */
export const DEFAULT_IDLE_LIMIT_MINUTES = 45;

/** The default as milliseconds, for anyone with no personal limit set. */
export const IDLE_LIMIT_MS = DEFAULT_IDLE_LIMIT_MINUTES * 60 * 1000;

/** The longest a personal limit may be, in minutes. Only a sane ceiling now that a
 *  counter locks rather than signs out — a typo of 9999 must not leave a till open
 *  for a week. */
export const MAX_IDLE_LIMIT_MINUTES = 6 * 60;

/** Warn this long before the axe, with a way to stay signed in. */
export const IDLE_WARNING_MS = 2 * 60 * 1000;

// ─── Counter PIN ─────────────────────────────────────────────────────────────

/** The counter PIN — lifts the lock, and signs in on that counter inside the two
 *  clocks above. Four digits, any four (owner, 2026-10-13): the till is already signed
 *  in on its own key, so the PIN only has to tell one colleague from another, never
 *  keep a stranger out. */
export const PIN_LENGTH = 4;

/** Wrong PINs in a row before the password is due — on the lock (which then signs
 *  out fully) and on the sign-in keypad alike. */
export const UNLOCK_MAX_FAILURES = 5;

// ─── Customer OTP (shop / portal sign-in) ────────────────────────────────────
// Used by `auth/otpChallenge.ts`, for both SMS and email codes.

/** Time to read the code and type it. */
export const OTP_CODE_TTL_MS = 10 * 60 * 1000;

/** Time to finish sign-in / onboarding once the code is verified. */
export const OTP_TICKET_TTL_MS = 5 * 60 * 1000;

/** Wrong guesses before the code dies. */
export const OTP_MAX_ATTEMPTS = 5;

// ─── Customer sign-out ───────────────────────────────────────────────────────
/** Where a customer lands after Sign out on the shop / portal — swap for a promo page any time. Same-site path only. */
export const CUSTOMER_SIGN_OUT_PATH = "/shop";
