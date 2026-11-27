/**
 * Counter PIN — kept on THIS PC only, never in a database (owner, 2026-11-27:
 * "totally insecure to save pin and password in same place … for real login we have
 * password, pin is for when already have login").
 *
 * Per person, a sealed file holds two things:
 *   • a scrypt hash of the four digits — checked here, the server never sees a PIN;
 *   • the "password note": a grant the server signed when the person typed their
 *     password on this counter (`src/shared/lib/auth/counterResume.ts`). The PIN only
 *     unlocks the note; the note is what signs the person back in, and the server
 *     still checks it — this counter, 10 days since the password, not ended by
 *     "Sign out everywhere", not marked as left.
 *
 *  • Sealed with `safeStorage` (Windows DPAPI): copied to another PC or Windows account
 *    it does not open. No safeStorage → no PIN at all.
 *  • 3 days with nobody using it here, or 5 wrong PINs → the entry is gone and the
 *    password is due.
 *  • Every password sign-in here renews the note (`refresh`), so the 10 days restart.
 */

import { app, safeStorage, session } from "electron";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const COOKIE = "authjs.session-token";   // pinned in src/auth.ts
const PIN_LENGTH = 4;
const MAX_TRIES = 5;
/** Same as LOGIN_IDLE_MAX_AGE_MS in src/shared/lib/constants/session.ts. */
const IDLE_MAX_MS = 3 * 24 * 60 * 60 * 1000;

interface Entry { salt: string; pinHash: string; grant: string; tries: number; lastUsedAt: number }
type Vault = Record<string, Entry>;

const file = () => path.join(app.getPath("userData"), "counter-pins.bin");
const key = (email: string) => email.trim().toLowerCase();
const hashPin = (pin: string, salt: string) => crypto.scryptSync(pin, salt, 32).toString("hex");

function readVault(): Vault {
    try {
        if (!safeStorage.isEncryptionAvailable()) return {};
        const parsed = JSON.parse(safeStorage.decryptString(fs.readFileSync(file()))) as unknown;
        return parsed && typeof parsed === "object" ? (parsed as Vault) : {};
    } catch {
        return {};   // no file yet, or sealed by another PC / account — nobody has a PIN here
    }
}

function writeVault(vault: Vault): boolean {
    try {
        if (!safeStorage.isEncryptionAvailable()) return false;
        const tmp = `${file()}.tmp`;
        fs.writeFileSync(tmp, safeStorage.encryptString(JSON.stringify(vault)));
        fs.renameSync(tmp, file());
        return true;
    } catch (err) {
        console.error("[pinVault] could not save:", err);
        return false;
    }
}

/** Does this person have a usable PIN on this PC? (The face card, "Change PIN".) */
export function hasPin(email: string): boolean {
    const entry = readVault()[key(email)];
    return !!entry && Date.now() - entry.lastUsedAt <= IDLE_MAX_MS;
}

/**
 * Ask the server for a fresh password note, for whoever is signed in now. The
 * password is retyped and checked there; the PIN never goes.
 */
async function fetchGrant(serverUrl: string, password: string): Promise<{ email: string; grant: string } | { error: string }> {
    try {
        const jar = await session.defaultSession.cookies.get({});
        const cookie = jar.filter((c) => c.name === COOKIE || c.name.startsWith(`${COOKIE}.`))
            .map((c) => `${c.name}=${c.value}`).join("; ");
        if (!cookie) return { error: "Sign in first." };
        const res = await fetch(`${serverUrl}/api/me/counter-pin`, {
            method: "POST",
            headers: { "content-type": "application/json", cookie },
            body: JSON.stringify({ password }),
        });
        const out = await res.json().catch(() => ({})) as { email?: string; grant?: string; error?: string };
        if (!res.ok || !out.email || !out.grant) return { error: out.error || "Could not check your password." };
        return { email: key(out.email), grant: out.grant };
    } catch {
        return { error: "Could not check your password." };
    }
}

/** "Set PIN" — for whoever is signed in now, with their password retyped. */
export async function setPin(
    serverUrl: string | null, pin: unknown, password: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!serverUrl) return { ok: false, error: "Still starting. Try again in a moment." };
    if (typeof pin !== "string" || pin.length !== PIN_LENGTH || !/^\d+$/.test(pin)) {
        return { ok: false, error: `A PIN is exactly ${PIN_LENGTH} digits.` };
    }
    if (typeof password !== "string" || !password) return { ok: false, error: "Enter your password." };
    if (!safeStorage.isEncryptionAvailable()) {
        return { ok: false, error: "This PC cannot keep a PIN safely (Windows protected storage is off)." };
    }
    const got = await fetchGrant(serverUrl, password);
    if ("error" in got) return { ok: false, error: got.error };
    const salt = crypto.randomBytes(16).toString("hex");
    const vault = readVault();
    vault[got.email] = { salt, pinHash: hashPin(pin, salt), grant: got.grant, tries: 0, lastUsedAt: Date.now() };
    return writeVault(vault) ? { ok: true } : { ok: false, error: "Could not save the PIN on this PC." };
}

/**
 * A password sign-in here: renew the note of a person who already has a PIN, so the
 * 10-day clock restarts. Silent and best-effort — nobody waits on it.
 */
export async function refreshPin(serverUrl: string | null, email: unknown, password: unknown): Promise<boolean> {
    if (!serverUrl || typeof email !== "string" || typeof password !== "string" || !password) return false;
    if (!readVault()[key(email)]) return false;
    const got = await fetchGrant(serverUrl, password);
    if ("error" in got) return false;
    const vault = readVault();
    const entry = vault[got.email];
    if (!entry) return false;
    vault[got.email] = { ...entry, grant: got.grant, tries: 0, lastUsedAt: Date.now() };
    return writeVault(vault);
}

/** "Remove PIN" on this PC. */
export function removePin(email: unknown): boolean {
    if (typeof email !== "string") return false;
    const vault = readVault();
    if (!vault[key(email)]) return true;
    delete vault[key(email)];
    return writeVault(vault);
}

export type PinCheck =
    | { ok: true; grant: string }
    | { ok: false; reason: "wrong" | "password" | "none" };

/**
 * Tapped photograph + four digits. Right → the password note, which the sign-in page
 * hands to the server. "password": idle too long or too many wrong tries — the entry
 * is gone. The caller reports a refused note with `dropPin`.
 */
export function checkPin(email: unknown, pin: unknown): PinCheck {
    if (typeof email !== "string" || typeof pin !== "string") return { ok: false, reason: "wrong" };
    const who = key(email);
    const vault = readVault();
    const entry = vault[who];
    if (!entry) return { ok: false, reason: "none" };
    if (Date.now() - entry.lastUsedAt > IDLE_MAX_MS) {
        delete vault[who];
        writeVault(vault);
        return { ok: false, reason: "password" };
    }
    const given = Buffer.from(hashPin(pin, entry.salt), "hex");
    const saved = Buffer.from(entry.pinHash, "hex");
    if (given.length !== saved.length || !crypto.timingSafeEqual(given, saved)) {
        entry.tries += 1;
        const out = entry.tries >= MAX_TRIES;
        if (out) delete vault[who];
        writeVault(vault);
        return { ok: false, reason: out ? "password" : "wrong" };
    }
    vault[who] = { ...entry, tries: 0, lastUsedAt: Date.now() };
    writeVault(vault);
    return { ok: true, grant: entry.grant };
}
