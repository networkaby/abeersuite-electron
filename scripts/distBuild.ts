/**
 * What a `dist` build left in `dist-app/`, and the `latest.yml` that describes it.
 *
 * electron-builder writes no `latest.yml` without a publish config, so a `dist` build has
 * to make its own — always from the installer itself, never from a file beside it. Shared
 * by `dist-pin.ts` (after the build) and `release-electron.ts --reuse-installer`.
 */
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import { readPackagedVersion } from "./packagedVersion";

export interface DistBuild {
    installer: string;
    blockmap: string;
    manifest: string;
    sha512: string;
    size: number;
}

export const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf-8" }).trim();

export const markerFor = (version: string) => `dist-v${version}`;

/** The installer built for `version`, checked against its pack. Throws when they do not belong together. */
export function readDistBuild(distDir: string, version: string): DistBuild {
    const pack = path.join(distDir, "win-unpacked");
    const installer = path.join(distDir, `AbeerSuite-Setup-${version}.exe`);
    const blockmap = `${installer}.blockmap`;
    for (const f of [path.join(pack, "AbeerSuite.exe"), installer, blockmap]) {
        if (!fs.existsSync(f)) throw new Error(`${f} is missing.`);
    }
    const packed = readPackagedVersion(pack);
    if (packed !== version) throw new Error(`the pack says ${packed ?? "nothing"}, package.json says ${version}.`);
    if (fs.statSync(installer).mtimeMs < fs.statSync(path.join(pack, "AbeerSuite.exe")).mtimeMs) {
        throw new Error("the installer is older than the pack, so it was not made from it.");
    }
    const bytes = fs.readFileSync(installer);
    return {
        installer,
        blockmap,
        manifest: path.join(distDir, "latest.yml"),
        sha512: crypto.createHash("sha512").update(bytes).digest("base64"),
        size: bytes.length,
    };
}

/** Writes `latest.yml`. A JSON string is a valid YAML double-quoted one. */
export function writeManifest(build: DistBuild, version: string, releaseNotes: string, minimumCounterVersion: string): void {
    const file = path.basename(build.installer);
    const text = [
        `version: ${version}`,
        "files:",
        `  - url: ${file}`,
        `    sha512: ${build.sha512}`,
        `    size: ${build.size}`,
        `path: ${file}`,
        `sha512: ${build.sha512}`,
        `releaseNotes: ${JSON.stringify(releaseNotes)}`,
        "vendor:",
        `  minimumCounterVersion: ${minimumCounterVersion}`,
        `releaseDate: '${new Date().toISOString()}'`,
        "",
    ].join("\n");
    fs.writeFileSync(build.manifest, text);
}

/** The commit and installer hash a marker records, or null when there is no marker. */
export function readMarker(version: string): { commit: string; sha512: string | null } | null {
    const name = markerFor(version);
    if (!git("tag", "-l", name)) return null;
    const message = git("tag", "-l", "--format=%(contents)", name);
    return { commit: git("rev-parse", `${name}^{commit}`), sha512: /^sha512: (\S+)$/m.exec(message)?.[1] ?? null };
}
