import "server-only";
import fs from "fs";
import path from "path";
import { lockSecret, unlockSecret } from "@/shared/lib/ai/secretBox";

/**
 * "Counter .ini" AI keys — saved on this PC only, never in the database.
 * File: AI_LOCAL_KEYS_FILE (a till: userData/ai-keys.json, set by
 * electron/serverManager.ts), else .ai-keys.local.json in the project folder
 * (dev). { "<AiKey.id>": "<locked key>" }, each locked with this machine's
 * AUTH_SECRET, so a copied file opens on no other PC. Vercel has no PC to keep
 * it on — there the store is off.
 */

export const localKeyStoreAvailable = () => !process.env.VERCEL;

export const localKeysFile = () => process.env.AI_LOCAL_KEYS_FILE || path.join(/* turbopackIgnore: true */ process.cwd(), ".ai-keys.local.json"); // the ignore stops Next tracing the whole project into the counter build

let cache: Record<string, string> | null = null;

function readAll(): Record<string, string> {
    if (cache) return cache;
    try {
        const raw = JSON.parse(fs.readFileSync(localKeysFile(), "utf8")) as unknown;
        cache = raw && typeof raw === "object" ? (raw as Record<string, string>) : {};
    } catch {
        cache = {};
    }
    return cache;
}

function writeAll(next: Record<string, string>) {
    const file = localKeysFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
    fs.renameSync(tmp, file);
    cache = next;
}

export const hasLocalKey = (keyId: number) => !!readAll()[String(keyId)];

export function readLocalKey(keyId: number): string | null {
    const boxed = readAll()[String(keyId)];
    return boxed ? unlockSecret(boxed, "machine") : null;
}

export function saveLocalKey(keyId: number, plain: string) {
    if (!localKeyStoreAvailable()) throw new Error("This server has no PC to keep a local key on");
    writeAll({ ...readAll(), [String(keyId)]: lockSecret(plain, "machine") });
}

export function removeLocalKey(keyId: number) {
    const all = { ...readAll() };
    if (!(String(keyId) in all)) return;
    delete all[String(keyId)];
    writeAll(all);
}
