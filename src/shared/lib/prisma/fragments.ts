/**
 * Reusable Prisma `include` / `select` fragments. Drop these into `include:` or
 * `select:` blocks instead of inlining the same shape across routes.
 *
 *   const account = await prisma.account.findUnique({
 *     where: { id },
 *     include: {
 *       person: { include: { phones: selectPrimaryPhone, emails: selectPrimaryEmail } },
 *     },
 *   });
 *
 * Each literal value is narrowed individually with `as const` (Prisma's overloads
 * need `"desc"` / `"asc"` not `string`). The wrapping object stays mutable so
 * Prisma's `OrderByInput[]` type accepts the array.
 */

/**
 * Order phones by `isPrimary desc, id asc` and take only the first row.
 * Use as the value of an `include.phones` / `select.phones` field.
 */
export const selectPrimaryPhone = {
    orderBy: [{ isPrimary: "desc" as const }, { id: "asc" as const }],
    take: 1,
};

/**
 * Same as `selectPrimaryPhone` for the `Email` model.
 */
export const selectPrimaryEmail = {
    orderBy: [{ isPrimary: "desc" as const }, { id: "asc" as const }],
    take: 1,
};
