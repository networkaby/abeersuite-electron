/**
 * Generate the next opaque ID like `S50` (prefix + max numeric suffix + 1).
 *
 * Walks `model.findMany` with `select: { id: true }`, parses out trailing digits,
 * returns `{ id: ${prefix}${max+1}, n: max+1 }`. Use for entities that carry
 * human-readable opaque IDs (ticket statuses, workers, roles, pipelines)
 * instead of bare integers.
 *
 * The numeric suffix `n` is also handy as a default `order` when a row needs
 * to land at the end of an ordered list.
 *
 * Usage:
 *   const { id, n } = await generateNextOpaqueId(prisma.ticketStatus, "S");
 *   await prisma.ticketStatus.create({ data: { id, order: body.order ?? n } });
 */
export async function generateNextOpaqueId(
    model: { findMany: (args: { select: { id: true } }) => Promise<{ id: string }[]> },
    prefix: string,
): Promise<{ id: string; n: number }> {
    const existing = await model.findMany({ select: { id: true } });
    const maxN = existing.reduce((max, row) => {
        const n = parseInt(row.id.replace(/\D/g, ""), 10);
        return Number.isFinite(n) ? Math.max(max, n) : max;
    }, 0);
    const n = maxN + 1;
    return { id: `${prefix}${n}`, n };
}
