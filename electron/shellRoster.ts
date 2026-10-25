// ── Sign-in screen: the face roster and the login background ────────────────
// What the shell's sign-in screen (resources/shell/login.html) is painted from
// before the server is up. main.ts's shell:* IPC handlers read and write it.

import { app, net } from "electron";
import * as path from "path";
import * as fs from "fs";
import { pathToFileURL } from "url";
import * as crypto from "crypto";
import { writeJsonAtomic } from "./stateFile";

/**
 * Who has signed in on this PC — the face grid on the sign-in screen.
 *
 * A CONVENIENCE CACHE and nothing more. It decides whose photograph is offered, never
 * who may sign in: every card still goes through the same server-side sign-in, and a
 * roster someone hand-edited buys them precisely nothing. It lives on disk because the
 * shell paints before the server is up and often before the line is.
 *
 * Kept beside counter-setup.json in userData, so an app update leaves it alone.
 */
export type ShellRosterEntry = {
    email: string;
    name: string;
    title?: string;
    /** Every Position held, senior first. Shape mirrored in electron/preload.ts. */
    seats?: { title: string; scope: string }[];
    /** The profile photo's source URL — kept only to notice when it changes. */
    avatarUrl?: string;
    /** File name under faces/, or (over IPC) the file:// URL the shell can use. */
    avatarFile?: string;
    hasPin: boolean;
    lastLoginAt: string;
};

/** Past a dozen faces the grid is worse than the form it replaced. */
export const ROSTER_MAX = 12;

function rosterPath(): string {
    return path.join(app.getPath("userData"), "counter-roster.json");
}

function faceFile(name: string): string {
    return path.join(app.getPath("userData"), "faces", name);
}

export function readRoster(): ShellRosterEntry[] {
    try {
        const raw = fs.readFileSync(rosterPath(), "utf-8");
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((e): e is ShellRosterEntry =>
            !!e && typeof (e as ShellRosterEntry).email === "string" && typeof (e as ShellRosterEntry).name === "string");
    } catch {
        return [];   // Missing or unreadable — the shell falls back to its form.
    }
}

export function writeRoster(entries: ShellRosterEntry[]): void {
    try {
        writeJsonAtomic(rosterPath(), entries);
    } catch (err) {
        console.warn("[Shell] Could not save the face roster:", (err as Error).message);
    }
}

/**
 * Keep a copy of someone's profile photo, so tomorrow's sign-in needs no network.
 *
 * Same guards as the login background — an `image/` content type and a size cap — but
 * NOT the same "already held, skip" rule: a face has to follow the person's profile,
 * so the caller re-fetches whenever the source URL changes. Returns the file name to
 * store, or null, and a null costs a photograph and never a sign-in.
 */
export async function cacheFace(email: string, url: string): Promise<string | null> {
    if (!/^https?:\/\//i.test(url)) return null;
    const name = `${crypto.createHash("sha1").update(email).digest("hex")}.img`;
    try {
        const res = await net.fetch(url);
        if (!res.ok) return null;
        if (!(res.headers.get("content-type") || "").startsWith("image/")) return null;
        const buf = Buffer.from(await res.arrayBuffer());
        // Tighter than the login background's 8MB: a 52px circle never needs more, and
        // every face is carried to the screen as base64 now, so the cap bounds what the
        // roster costs to hand over as well as what it costs on disk.
        if (buf.byteLength > 1024 * 1024) return null;
        fs.mkdirSync(path.dirname(faceFile(name)), { recursive: true });
        fs.writeFileSync(faceFile(name), buf);
        return name;
    } catch (err) {
        console.warn("[Shell] Could not cache a profile photo:", (err as Error).message);
        return null;
    }
}

/**
 * The cached photograph, as a `data:` URL.
 *
 * NOT a `file://` path, which is what this used to hand over and why the app's own
 * sign-in page showed initials where the shell showed faces: the shell is a `file://`
 * document and could load one, but the page is served over http, and Chromium refuses a
 * `file://` subresource from an http document. A data URL is the one form BOTH screens
 * can display, so there is one shape to reason about instead of two.
 *
 * The type is read off the first bytes rather than stored, so the photographs already
 * cached on every till keep working without being re-fetched.
 */
export function faceDataUrl(name: string | undefined): string | undefined {
    if (!name) return undefined;
    try {
        const buf = fs.readFileSync(faceFile(name));
        const type =
            buf[0] === 0x89 && buf[1] === 0x50 ? "image/png"
                : buf[0] === 0xff && buf[1] === 0xd8 ? "image/jpeg"
                    : buf[0] === 0x47 && buf[1] === 0x49 ? "image/gif"
                        : buf.subarray(8, 12).toString("ascii") === "WEBP" ? "image/webp"
                            : null;
        if (!type) return undefined;   // Not an image we can name — initials instead.
        return `data:${type};base64,${buf.toString("base64")}`;
    } catch {
        return undefined;              // Missing or unreadable: initials, never a hole.
    }
}

export function forgetFace(name: string | undefined): void {
    if (!name) return;
    try { fs.rmSync(faceFile(name), { force: true }); } catch { /* a leftover picture is harmless */ }
}

/** Where an owner's own background lives, if they have dropped one in. */
export function loginBackgroundPath(): string {
    return path.join(app.getPath("userData"), "login-background.jpg");
}

/**
 * `?bg=` — the counter's own picture, when there is one.
 *
 * Passed as a file URL rather than a path because the shell hands it straight to CSS.
 * Absent when no picture has been dropped in, and the shell then falls back through its
 * configured photos to a background drawn in CSS, so the screen is never blank.
 */
export function shellQuery(): Record<string, string> {
    // The owner's own picture first, then the copy kept from the last time the shell
    // fetched one. Either way this is a local file, so a counter that has seen its
    // background once never waits on the network for it again.
    for (const candidate of [loginBackgroundPath(), path.join(app.getPath("userData"), "login-background-cache.jpg")]) {
        if (fs.existsSync(candidate)) return { bg: pathToFileURL(candidate).href };
    }
    return {};
}
