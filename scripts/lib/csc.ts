/**
 * Shared plumbing for the two small C# helpers this repo ships alongside the
 * Electron app: `AbeerSuite-WebSetup.exe` (scripts/build-downloader.ts) and the
 * update splash (scripts/build-update-splash.ts).
 *
 * Both are tiny WinForms executables built with the .NET Framework compiler that
 * is already on every Windows machine — no toolchain to install, and an output
 * measured in kilobytes. They exist because neither job can be done by Electron:
 * the downloader runs before the app exists, and the splash has to stay on screen
 * while the app's own binary is being overwritten.
 */

import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";

/** The .NET Framework compiler shipped with Windows. */
export function findCsc(): string {
    const candidates = [
        "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe",
        "C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe",
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }
    throw new Error("Could not find .NET Framework csc.exe compiler on this Windows machine.");
}

/**
 * Produces `build/icon.ico` from `build/icon.png` if it is not there already.
 *
 * Windows accepts a PNG inside an ICO container since Vista, so this is a 22-byte
 * header in front of the PNG rather than a real image conversion — no image
 * library, and the icon stays a single source file in the repo.
 *
 * Never throws: a missing icon costs a default one on a helper executable, which
 * is not worth failing a build over.
 */
export function ensureIco(iconPng: string, iconIco: string, logPrefix: string): string | null {
    if (fs.existsSync(iconIco)) return iconIco;
    if (!fs.existsSync(iconPng)) {
        console.warn(`${logPrefix} Warning: ${path.basename(iconPng)} not found, skipping icon embedding.`);
        return null;
    }

    try {
        const pngBuf = fs.readFileSync(iconPng);
        const icoHeader = Buffer.alloc(22);
        icoHeader.writeUInt16LE(0, 0); // Reserved
        icoHeader.writeUInt16LE(1, 2); // ICO type
        icoHeader.writeUInt16LE(1, 4); // Image count (1)

        icoHeader.writeUInt8(0, 6);    // Width: 0 means 256
        icoHeader.writeUInt8(0, 7);    // Height: 0 means 256
        icoHeader.writeUInt8(0, 8);    // Color count
        icoHeader.writeUInt8(0, 9);    // Reserved
        icoHeader.writeUInt16LE(1, 10); // Color planes
        icoHeader.writeUInt16LE(32, 12); // Bits per pixel
        icoHeader.writeUInt32LE(pngBuf.length, 14); // Image byte length
        icoHeader.writeUInt32LE(22, 18); // Image data offset

        fs.writeFileSync(iconIco, Buffer.concat([icoHeader, pngBuf]));
        console.log(`${logPrefix} Generated ${path.basename(iconIco)} from ${path.basename(iconPng)}.`);
        return iconIco;
    } catch (err) {
        console.warn(`${logPrefix} Could not generate icon.ico:`, err);
        return null;
    }
}

/** Compiles one .cs file into a windowless executable. Throws on any csc failure. */
export function compileWinExe(opts: {
    source: string;
    outExe: string;
    icon?: string | null;
    references?: string[];
    logPrefix: string;
}): void {
    const references = opts.references ?? ["System.dll", "System.Drawing.dll", "System.Windows.Forms.dll"];
    const args = [
        "/target:winexe",
        "/optimize+",
        "/platform:anycpu",
        "/nologo",
        `/out:${opts.outExe}`,
        `/r:${references.join(",")}`,
    ];
    if (opts.icon) args.push(`/win32icon:${opts.icon}`);
    args.push(opts.source);

    fs.mkdirSync(path.dirname(opts.outExe), { recursive: true });
    console.log(`${opts.logPrefix} Compiling ${path.basename(opts.outExe)} using ${path.basename(findCsc())}...`);
    const result = spawnSync(findCsc(), args, { stdio: "inherit" });
    if (result.status !== 0) {
        throw new Error(`csc compilation failed with exit code ${result.status}`);
    }
}
