/**
 * Builds `resources/AbeerSuiteUpdateSplash.exe` — the window a counter sees while
 * an update installs and the app itself is gone.
 *
 * Runs as part of `pnpm electron:build`, so the splash in a package is always the
 * one built from the source next to it. The output ships through extraResources;
 * electron/updateManager.ts copies it to %TEMP% and starts it there, because the
 * copy inside the program folder is locked while NSIS overwrites that folder.
 *
 * See scripts/update-splash/AbeerSuiteUpdateSplash.cs for why this is C# and not
 * a second Electron window.
 */

import * as path from "path";
import { compileWinExe, ensureIco } from "./lib/csc";

const ROOT = process.cwd();
const SOURCE_CS = path.join(ROOT, "scripts", "update-splash", "AbeerSuiteUpdateSplash.cs");
const OUT_EXE = path.join(ROOT, "resources", "AbeerSuiteUpdateSplash.exe");
const ICON_PNG = path.join(ROOT, "build", "icon.png");
const ICON_ICO = path.join(ROOT, "build", "icon.ico");
const LOG = "[build-update-splash]";

compileWinExe({
    source: SOURCE_CS,
    outExe: OUT_EXE,
    icon: ensureIco(ICON_PNG, ICON_ICO, LOG),
    logPrefix: LOG,
});

console.log(`${LOG} SUCCESS: ${path.relative(ROOT, OUT_EXE)}`);
