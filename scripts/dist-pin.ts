/**
 * Pins the `dist` build in `dist-app/`: writes its `latest.yml` and the local
 * `dist-v<version>` marker tag. Run after `pnpm electron:dist` has passed its gate.
 *
 * Every check stops before anything is written. A marker that already names this very
 * installer is kept where it is, so re-running from a later commit only writes `latest.yml`.
 */
import * as fs from "fs";
import * as path from "path";
import { parse } from "dotenv";
import { git, markerFor, readDistBuild, readMarker, writeManifest } from "./distBuild";

function pin(): void {
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf-8")) as { version: string; minimumCounterVersion: string };
    const { version } = pkg;
    if (git("tag", "-l", `v${version}`)) throw new Error(`v${version} already exists — that version has shipped.`);

    const distDir = path.join(process.cwd(), "dist-app");
    const build = readDistBuild(distDir, version);
    const marker = readMarker(version);

    if (marker?.sha512 !== build.sha512) {
        if (git("status", "--porcelain")) throw new Error("the working tree is not clean.");
        const packedAt = fs.statSync(path.join(distDir, "win-unpacked", "AbeerSuite.exe")).mtimeMs;
        if (Number(git("log", "-1", "--format=%ct")) * 1000 > packedAt) {
            throw new Error("HEAD is newer than the pack, so it was not built from this commit.");
        }
        const env = parse(fs.readFileSync(path.join(distDir, "win-unpacked", "resources", "counter.env")));
        const variant = ["APP_MODE", "LANDING_PAGE", "READ_MODE", "WRITE_MODE"].map((k) => `${k}=${env[k] ?? ""}`).join(" ");
        git("tag", "-a", "-f", markerFor(version), "-m", [
            `dist v${version} — local test build, never push`,
            `installer: ${path.basename(build.installer)}`,
            `sha512: ${build.sha512}`,
            `variant: ${variant}`,
        ].join("\n"));
    }

    const notes = fs.readFileSync("RELEASE_NOTES.md", "utf-8").trim();
    writeManifest(build, version, notes, pkg.minimumCounterVersion);
    console.log(`[dist-pin] latest.yml written for ${version}. Marker:\n${git("tag", "-l", "-n9", markerFor(version))}`);
}

try {
    pin();
} catch (e) {
    console.error(`[dist-pin] FATAL: ${(e as Error).message}`);
    process.exit(1);
}
