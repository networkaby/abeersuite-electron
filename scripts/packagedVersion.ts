/**
 * Reads the version that is actually baked into a packaged tree.
 *
 * This is NOT the same number as `package.json`'s, and the gap is the point. electron-builder
 * writes a generated `package.json` into `app.asar` at pack time; `app.getVersion()` — and
 * therefore everything `electron-updater` compares — reads that copy, not the one in the repo.
 * Bumping the repo's version after a pack changes the installer's NAME and `latest.yml`, but
 * not the number the installed app reports about itself.
 *
 * That combination is an update loop on every till: `latest.yml` offers 1.3.8, the counter
 * installs it, the app still says 1.3.7, so the updater offers 1.3.8 again, forever. Reading
 * the packed number is the only way to catch it before it is published.
 *
 * Only the asar HEADER plus one small entry is read, so this costs nothing on a 600 MB archive.
 */
import * as fs from "fs";
import * as path from "path";

/** Where electron-builder puts the app archive inside a packaged tree. */
export function asarPathFor(packageDir: string): string {
    return path.join(packageDir, "resources", "app.asar");
}

/**
 * The version inside `packageDir`'s `app.asar`, or `null` when it cannot be determined
 * (no asar, no `package.json` entry, unreadable header). `null` means "unknown", never "fine" —
 * callers treat it as a failure rather than waving the package through.
 */
export function readPackagedVersion(packageDir: string): string | null {
    const asarPath = asarPathFor(packageDir);
    if (!fs.existsSync(asarPath)) return null;

    const fd = fs.openSync(asarPath, "r");
    try {
        // An asar opens with a small pickle: bytes 4-8 hold the pickle's own size (the data
        // section starts at 8 + that, 4-byte aligned) and bytes 12-16 the header JSON length.
        const prefix = Buffer.alloc(16);
        fs.readSync(fd, prefix, 0, 16, 0);
        const pickleSize = prefix.readUInt32LE(4);
        const headerSize = prefix.readUInt32LE(12);

        const headerBuf = Buffer.alloc(headerSize);
        fs.readSync(fd, headerBuf, 0, headerSize, 16);
        const header = JSON.parse(headerBuf.toString("utf8"));

        const entry = header?.files?.["package.json"];
        if (!entry || typeof entry.size !== "number") return null;

        const dataStart = 8 + pickleSize;
        const buf = Buffer.alloc(entry.size);
        fs.readSync(fd, buf, 0, entry.size, dataStart + Number(entry.offset));
        const version = JSON.parse(buf.toString("utf8"))?.version;
        return typeof version === "string" ? version : null;
    } catch {
        return null;
    } finally {
        fs.closeSync(fd);
    }
}
