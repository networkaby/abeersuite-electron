/**
 * Proves the counter's userData state files read and write the way boot depends on
 * (electron/stateFile.ts, electron/installationId.ts): a file cut short reads as
 * CORRUPT, never as absent, and the installation id is never re-minted on a PC that
 * holds a counter.
 *
 * Works in a temp folder — touches no real userData and no database. The lock test
 * shells out to PowerShell, so it runs on Windows only and is skipped elsewhere.
 *
 *   pnpm check:state-file
 */

import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { readJsonState, writeJsonAtomic } from "../electron/stateFile";
import { resolveInstallationId } from "../electron/installationId";

type Check = [name: string, ok: boolean];

const setupShape = (raw: unknown) => {
    const d = raw as { counterId?: unknown; counterNumber?: unknown } | null;
    return typeof d?.counterId === "number" && typeof d?.counterNumber === "number"
        ? { counterId: d.counterId, counterNumber: d.counterNumber }
        : null;
};

const tmpFiles = (dir: string) => fs.readdirSync(dir).filter((f) => f.endsWith(".tmp"));

function freshDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "state-file-check-"));
}

function readWriteChecks(): Check[] {
    const dir = freshDir();
    const file = path.join(dir, "counter-setup.json");
    const checks: Check[] = [];

    checks.push(["missing file → absent", readJsonState(file, setupShape).kind === "absent"]);

    writeJsonAtomic(file, { counterId: 3, counterNumber: 23 });
    const back = readJsonState(file, setupShape);
    checks.push(["round trip → present", back.kind === "present" && back.value.counterNumber === 23]);
    checks.push(["no temp file left after a write", tmpFiles(dir).length === 0]);

    fs.writeFileSync(file, '{"counterId": 3, "counterNu');
    checks.push(["cut short mid-write → corrupt, not absent", readJsonState(file, setupShape).kind === "corrupt"]);

    fs.writeFileSync(file, "");
    checks.push(["empty file → corrupt", readJsonState(file, setupShape).kind === "corrupt"]);

    fs.writeFileSync(file, '{"counterId":"3"}');
    checks.push(["wrong shape → corrupt", readJsonState(file, setupShape).kind === "corrupt"]);

    fs.writeFileSync(file, '﻿{"counterId":3,"counterNumber":23}');
    checks.push(["byte-order mark → present", readJsonState(file, setupShape).kind === "present"]);

    // A stray temp file from an interrupted write does not affect reads or the next write.
    writeJsonAtomic(file, { counterId: 3, counterNumber: 23 });
    fs.writeFileSync(path.join(dir, ".counter-setup.json.999.1.tmp"), '{"counterId": 9');
    checks.push(["stray temp file ignored on read", readJsonState(file, setupShape).kind === "present"]);
    writeJsonAtomic(file, { counterId: 4, counterNumber: 24 });
    const after = readJsonState(file, setupShape);
    checks.push(["next write succeeds beside a stray temp", after.kind === "present" && after.value.counterNumber === 24]);

    fs.rmSync(dir, { recursive: true, force: true });
    return checks;
}

function identityChecks(): Check[] {
    const checks: Check[] = [];
    const idFile = (dir: string) => path.join(dir, "counter-installation-id.json");

    {
        const dir = freshDir();
        const r = resolveInstallationId(dir, "absent");
        checks.push(["fresh PC, no counter → minted", r.source === "minted" && !!r.id]);
        checks.push(["minted id written with its copy", fs.existsSync(idFile(dir)) && fs.existsSync(`${idFile(dir)}.bak`)]);
        const again = resolveInstallationId(dir, "present");
        checks.push(["next boot reads the same id", again.id === r.id && again.source === "file"]);
        fs.rmSync(dir, { recursive: true, force: true });
    }
    {
        const dir = freshDir();
        fs.writeFileSync(idFile(dir), JSON.stringify({ counterId: "COUNTER-abc" }));
        const r = resolveInstallationId(dir, "present");
        checks.push(["existing till: id kept", r.id === "COUNTER-abc" && r.source === "file"]);
        checks.push(["existing till: copy written on first boot", fs.existsSync(`${idFile(dir)}.bak`)]);
        fs.rmSync(dir, { recursive: true, force: true });
    }
    {
        const dir = freshDir();
        fs.writeFileSync(`${idFile(dir)}.bak`, JSON.stringify({ counterId: "COUNTER-abc" }));
        fs.writeFileSync(idFile(dir), '{"counterId": "COUN');
        const r = resolveInstallationId(dir, "present");
        checks.push(["cut-short id + good copy → restored", r.id === "COUNTER-abc" && r.source === "backup"]);
        const main = readJsonState(idFile(dir), (x) => (x as { counterId?: string }).counterId ?? null);
        checks.push(["restored file readable again", main.kind === "present" && main.value === "COUNTER-abc"]);
        fs.rmSync(dir, { recursive: true, force: true });
    }
    {
        const dir = freshDir();
        fs.writeFileSync(idFile(dir), '{"counterId": "COUN');
        fs.writeFileSync(`${idFile(dir)}.bak`, "");
        const before = fs.readFileSync(idFile(dir));
        const r = resolveInstallationId(dir, "present");
        checks.push(["both copies bad on a counter → lost, not re-minted", r.id === null && r.source === "lost"]);
        checks.push(["lost: the damaged bytes are left as they were", fs.readFileSync(idFile(dir)).equals(before)]);
        const corruptSetup = resolveInstallationId(dir, "corrupt");
        checks.push(["both bad + setup file damaged → still lost", corruptSetup.id === null]);
        fs.rmSync(dir, { recursive: true, force: true });
    }
    {
        const dir = freshDir();
        fs.writeFileSync(idFile(dir), '{"counterId": "COUN');
        const r = resolveInstallationId(dir, "absent");
        checks.push(["both bad on a PC with no counter → minted", r.source === "minted" && !!r.id]);
        checks.push(["damaged id file set aside, not deleted", fs.readdirSync(dir).some((f) => f.includes(".corrupt-"))]);
        fs.rmSync(dir, { recursive: true, force: true });
    }
    return checks;
}

/** Hold the target open with no sharing (as antivirus can) for `holdMs`, then write. */
async function lockedWrite(holdMs: number): Promise<{ wrote: boolean; original: string | null; leftTmp: number }> {
    const dir = freshDir();
    const file = path.join(dir, "counter-setup.json");
    writeJsonAtomic(file, { counterId: 1, counterNumber: 1 });
    const ps = spawn("powershell.exe", [
        "-NoProfile", "-NonInteractive", "-Command",
        `$f = [IO.File]::Open('${file}', 'Open', 'Read', 'None'); Write-Output locked; Start-Sleep -Milliseconds ${holdMs}; $f.Close()`,
    ]);
    await new Promise<void>((resolve) => ps.stdout.once("data", () => resolve()));
    let wrote = false;
    try {
        writeJsonAtomic(file, { counterId: 2, counterNumber: 2 });
        wrote = true;
    } catch {
        wrote = false;
    }
    await new Promise<void>((resolve) => ps.once("exit", () => resolve()));
    const original = wrote ? null : fs.readFileSync(file, "utf8");
    const leftTmp = tmpFiles(dir).length;
    fs.rmSync(dir, { recursive: true, force: true });
    return { wrote, original, leftTmp };
}

async function lockChecks(): Promise<Check[]> {
    if (process.platform !== "win32") return [];
    const brief = await lockedWrite(300);
    const long = await lockedWrite(3000);
    return [
        ["target locked 300 ms → the write waits and succeeds", brief.wrote && brief.leftTmp === 0],
        ["target locked 3 s → the write fails", !long.wrote],
        ["…and the old file is intact", long.original !== null && JSON.parse(long.original).counterId === 1],
        ["…and no temp file is left behind", long.leftTmp === 0],
    ];
}

async function main() {
    const checks = [...readWriteChecks(), ...identityChecks(), ...(await lockChecks())];
    let failed = 0;
    for (const [name, ok] of checks) {
        console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
        if (!ok) failed++;
    }
    console.log(`\n${checks.length - failed}/${checks.length} passed`);
    process.exit(failed === 0 ? 0 : 1);
}

void main();
