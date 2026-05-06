import { MODULE_SECTIONS } from "./constants";

export function getActiveModuleKey(pathname: string): string | null {
    for (const mod of MODULE_SECTIONS) {
        const prefixes = mod.pathPrefixes ?? [];
        if (prefixes.some((p) => pathname.startsWith(p))) {
            return mod.key;
        }
    }
    return null;
}

export function getActiveModule(pathname: string) {
    const key = getActiveModuleKey(pathname);
    if (!key) return null;
    return MODULE_SECTIONS.find((m) => m.key === key) ?? null;
}
