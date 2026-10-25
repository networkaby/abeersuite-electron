// ── counter-setup.json ──────────────────────────────────────────────────────
// Which PosCounter (and its counterNumber) this PC is bound to — see the
// "First-launch counter setup" note in main.ts. Reading it only; the writes and
// the recovery from a damaged file stay in main.ts with the boot path.

import { app } from "electron";
import * as path from "path";
import { readJsonState, type StateRead } from "./stateFile";

export interface CounterSetup {
    counterId: number;
    counterNumber: number;
}

export function counterSetupFilePath(): string {
    return path.join(app.getPath("userData"), "counter-setup.json");
}

export function parseCounterSetup(raw: unknown): CounterSetup | null {
    const data = raw as { counterId?: unknown; counterNumber?: unknown } | null;
    return typeof data?.counterId === "number" && typeof data?.counterNumber === "number"
        ? { counterId: data.counterId, counterNumber: data.counterNumber }
        : null;
}

/** present / absent / corrupt — boot treats each differently (see the replica section). */
export function readCounterSetupState(): StateRead<CounterSetup> {
    return readJsonState(counterSetupFilePath(), parseCounterSetup);
}

export function readCounterSetup(): CounterSetup | null {
    const state = readCounterSetupState();
    return state.kind === "present" ? state.value : null;
}
