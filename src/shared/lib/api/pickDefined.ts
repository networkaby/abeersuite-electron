/**
 * Drop keys whose value is `undefined` — for building a Prisma PATCH `data`
 * object from a partial update body without spreading per field.
 *
 * Usage:
 *   data: pickDefined({ code: b.code?.toUpperCase(), label: b.label, isActive: b.isActive })
 */
export function pickDefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
    return Object.fromEntries(
        Object.entries(obj).filter(([, v]) => v !== undefined),
    ) as Partial<T>;
}
