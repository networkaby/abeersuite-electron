/**
 * Orders two app versions ("1.17.0", "1.17.0-pre.1"). Negative when a < b, 0 when equal,
 * positive when a > b.
 *
 * Shared by the counter's updater (is this install below the release's minimum?) and
 * scripts/release-electron.ts (did the minimum move?). Our versions are always
 * major.minor.patch with an optional "-" suffix for test builds, so this is all of
 * semver we need: a suffixed version sorts below the same version without one, and two
 * suffixes compare as plain text.
 */
export function compareVersions(a: string, b: string): number {
    const [coreA, preA = ""] = a.trim().replace(/^v/, "").split(/-(.*)/);
    const [coreB, preB = ""] = b.trim().replace(/^v/, "").split(/-(.*)/);
    const partsA = coreA.split(".").map((n) => Number(n) || 0);
    const partsB = coreB.split(".").map((n) => Number(n) || 0);
    for (let i = 0; i < 3; i++) {
        const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
        if (diff !== 0) return diff;
    }
    if (preA === preB) return 0;
    if (!preA) return 1;
    if (!preB) return -1;
    return preA < preB ? -1 : 1;
}

/** "1.17.0" or "1.17.0-pre.1"; anything else is not a version we publish. */
export function isAppVersion(v: unknown): v is string {
    return typeof v === "string" && /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(v.trim());
}
