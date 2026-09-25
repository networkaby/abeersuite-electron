/**
 * Sign-in clocks — how long a login lasts, when an idle person is signed out, and
 * how far the counter PIN and the customer OTP are trusted.
 *
 * Three different clocks, easy to confuse:
 *
 *   • IDLE SIGN-OUT (45 min, per person) — no click or key for this long and the
 *     screen signs the person out. Also where duty time stops counting.
 *   • LOGIN LIFETIME (6 h) — the backstop the server enforces on its own, for a
 *     machine with the app shut where no screen timer is running.
 *   • COUNTER PIN (10 days / 3 days) — how long the PIN may stand in for the
 *     password on a till.
 */

// ─── Login lifetime ──────────────────────────────────────────────────────────
// Both halves need it and they live on opposite sides: `src/auth.ts` enforces it,
// and the screen that has just been signed out has to be able to SAY it. A number
// copied into a sentence goes stale the first time the number changes.
//
// Not to be confused with the PIN clocks below, which look like the same idea and
// are the opposite one: those say how long a PIN may stand in for a password, this
// says how soon the PIN is asked for at all. Making this the longer of the two
// means the PIN screen never appears and the password rule never runs — which is
// exactly the bug it was written from.

/** Six hours. Checked against the shop's hours: tills open 10:30–12:20 and close
 *  20:30–22:18, so the shortest night is about twice this, while nothing inside a
 *  trading day sits quiet for six. It lapses every night and never mid-shift. */
export const SESSION_IDLE_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** The same span in words, for the line shown to whoever was just signed out. */
export const SESSION_IDLE_LABEL = `${SESSION_IDLE_MAX_AGE_MS / (60 * 60 * 1000)} hours`;

// ─── Idle sign-out ───────────────────────────────────────────────────────────

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

/**
 * The longest a personal limit may be, in minutes.
 *
 * The login itself ends after SESSION_IDLE_MAX_AGE_MS (6 hours) no matter what.
 * A personal limit above it would be a promise this code cannot keep: the session
 * would go first and the person would be signed out earlier than their own setting
 * said. So it is capped, and the cap is honest.
 */
export const MAX_IDLE_LIMIT_MINUTES = 6 * 60;

/** Warn this long before the axe, with a way to stay signed in. */
export const IDLE_WARNING_MS = 2 * 60 * 1000;

// ─── Counter PIN ─────────────────────────────────────────────────────────────
// The PIN never replaces the password: these two clocks force the real password
// back every so often, and after a few idle days. The rules that use them are in
// `auth/counterPin.ts`.

/** Type the password again this long after last typing it here. */
export const PIN_PASSWORD_MAX_AGE_MS = 10 * 24 * 60 * 60 * 1000;

/** ...or this long after the last sign-in of any kind here, whichever bites first. */
export const PIN_IDLE_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

// ─── Customer OTP (shop / portal sign-in) ────────────────────────────────────
// Used by `auth/otpChallenge.ts`, for both SMS and email codes.

/** Time to read the code and type it. */
export const OTP_CODE_TTL_MS = 10 * 60 * 1000;

/** Time to finish sign-in / onboarding once the code is verified. */
export const OTP_TICKET_TTL_MS = 5 * 60 * 1000;

/** Wrong guesses before the code dies. */
export const OTP_MAX_ATTEMPTS = 5;
