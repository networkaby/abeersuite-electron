/**
 * "Open the counter-PIN panel once, as soon as this person is signed in."
 *
 * Pressed on a sign-in screen, where nobody is signed in yet and so nothing can be
 * set — the intent has to survive exactly one navigation and then be forgotten. The
 * sign-in page writes it; `CounterPinButton`, which is the only place that can
 * actually set a PIN, reads it once and clears it.
 *
 * Session-scoped on purpose: a note like this must never outlive the day it was
 * written. It is an intent and nothing more — it unlocks nothing, so a browser that
 * refuses storage simply means the cashier uses the line in the sidebar instead.
 *
 * Its own file so the sidebar does not have to import the login page to learn one
 * string.
 */
export const OPEN_COUNTER_PIN_KEY = "abeer:open-counter-pin";
