/**
 * How long a sign-in survives without being used.
 *
 * Its own module because both halves need it and they live on opposite sides:
 * `src/auth.ts` enforces it, and the screen that has just been signed out has to
 * be able to SAY it. A number copied into a sentence goes stale the first time
 * the number changes, and the wrong one on screen is worse than none.
 *
 * Not to be confused with the two clocks in `counterPin.ts`, which look like the
 * same idea and are the opposite one: those say how long a PIN may stand in for a
 * password (10 days of use, 3 days idle), this says how soon the PIN is asked for
 * at all. Making this the longer of the two means the PIN screen never appears and
 * the password rule never runs — which is exactly the bug it was written from.
 */

/** Six hours. Checked against the shop's hours: tills open 10:30–12:20 and close
 *  20:30–22:18, so the shortest night is about twice this, while nothing inside a
 *  trading day sits quiet for six. It lapses every night and never mid-shift. */
export const SESSION_IDLE_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** The same span in words, for the line shown to whoever was just signed out. */
export const SESSION_IDLE_LABEL = `${SESSION_IDLE_MAX_AGE_MS / (60 * 60 * 1000)} hours`;
