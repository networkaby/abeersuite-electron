/**
 * Constants — every setting you might want to find or change, one file per topic.
 *
 *   nav.ts            the office sidebar: Workspace, module sections, Admin, Settings
 *   quickActions.ts   the Quick Actions bar and the POS action rail
 *   badges.ts         status / priority badge colours, colour choices on settings pages
 *
 *   session.ts        login lifetime, idle sign-out (45 min) + its warning,
 *                     counter PIN clocks, customer OTP timings
 *   hr.ts             duty hours, full-day length, late grace, full/half-day shares,
 *                     pay days a month, leave year, off-counter tracking switch
 *   polling.ts        how often each screen re-reads the server (the DB-cost dial)
 *   paging.ts         rows per API page / per directory page
 *   inventory.ts      Reorder classifier ladder, FSN fast-mover turnover
 *   accounting.ts     standard group / ledger names, payment instruments, bill due days
 *   business.ts       the shop's time zone
 *
 *   companyDetails.ts shop name, address, GSTIN, bank — printed on every document
 *   loginShowcase.ts  what the sign-in screens say
 *   permissions.ts    permission id strings (the catalog itself is auth/permissionCatalog.ts)
 *   workflow.ts       which workflow status ids play which role
 *
 * Import from the file itself (`@/shared/lib/constants/session`), not from here —
 * that is what every caller does. nav.ts and quickActions.ts are deliberately NOT
 * re-exported below: they carry the icon set, which server code has no use for.
 *
 * Not everything named in CAPITALS belongs here. A list only one file uses stays
 * beside that file, and a few numbers must never be casually edited because stored
 * data depends on them — the counter id block size (`counter/idRange.ts`), the
 * secret date-code bucket printed on labels (`inventory/lib/secretDateCode.ts`),
 * the sidebar badge surface keys (`nav/navSurfaces.ts`). Those stay with their code.
 */
export * from "./accounting";
export * from "./business";
export * from "./permissions";
export * from "./companyDetails";
export * from "./polling";
export * from "./loginShowcase";
export * from "./session";
export * from "./hr";
export * from "./paging";
export * from "./inventory";
export * from "./badges";
export * from "./workflow";
