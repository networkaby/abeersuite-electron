/**
 * This PC's installation id — the value `pos_counters.boundDeviceId` holds for the
 * counter bound to it. Minted once and kept in userData, with a copy beside it.
 *
 * The id must never change silently. It used to be re-minted whenever its file could
 * not be read, so one damaged file made the PC a stranger to its own counter: the boot
 * binding check then found no row carrying the new id, reset the counter and emptied
 * the replica — unsent sales included.
 *
 * So: the file, else its copy, else — only on a PC that holds no counter — a new id.
 * A PC that holds a counter but has lost both copies gets no id ("lost"): every check
 * that needs one already treats a missing id as "cannot tell" and changes nothing, and
 * support restores the file. Never re-derived from the replica: the row cannot tell this
 * PC's id from the one a different PC bound after a release, and two tills sharing an
 * id would share one id block.
 *
 * Node built-ins only, so `tsx` can run it from scripts/check-state-file.ts.
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { readJsonState, setAsideCorrupt, writeJsonAtomic, type StateRead } from "./stateFile";

export type InstallationId =
    | { id: string; source: "file" | "backup" | "minted" }
    | { id: null; source: "lost"; detail: string };

const FILE = "counter-installation-id.json";

function parseId(raw: unknown): string | null {
    const id = (raw as { counterId?: unknown } | null)?.counterId;
    return typeof id === "string" && id.length > 0 ? id : null;
}

/**
 * @param dir       userData
 * @param setupKind how counter-setup.json read — only "absent" (no counter here) may mint
 */
export function resolveInstallationId(dir: string, setupKind: StateRead<unknown>["kind"]): InstallationId {
    const file = path.join(dir, FILE);
    const backup = `${file}.bak`;
    const main = readJsonState(file, parseId);
    const copy = readJsonState(backup, parseId);

    if (main.kind === "present") {
        // Existing tills get their copy on the first boot of this version.
        if (copy.kind !== "present" || copy.value !== main.value) {
            try { fs.copyFileSync(file, backup); } catch (err) { console.error("[InstallationId] Could not write the backup copy:", err); }
        }
        return { id: main.value, source: "file" };
    }

    if (copy.kind === "present") {
        if (main.kind === "corrupt") setAsideCorrupt(file);
        persist(file, { counterId: copy.value, restoredAt: new Date().toISOString() });
        console.warn(`[InstallationId] ${FILE} was ${main.kind}; restored from its backup copy.`);
        return { id: copy.value, source: "backup" };
    }

    if (setupKind !== "absent") {
        const detail = `${FILE} is ${main.kind} and its backup is ${copy.kind}, on a PC that holds a counter`;
        console.error(`[InstallationId] Identity lost — ${detail}. Nothing is reset; restore the file.`);
        return { id: null, source: "lost", detail };
    }

    if (main.kind === "corrupt") setAsideCorrupt(file);
    const id = `COUNTER-${crypto.randomUUID()}`;
    const body = { counterId: id, createdAt: new Date().toISOString() };
    persist(file, body);
    persist(backup, body);
    return { id, source: "minted" };
}

/** A failed write is logged, not thrown: the id still serves this run, as it always has. */
function persist(file: string, body: object): void {
    try {
        writeJsonAtomic(file, body);
    } catch (err) {
        console.error(`[InstallationId] Could not write ${path.basename(file)}:`, err);
    }
}
