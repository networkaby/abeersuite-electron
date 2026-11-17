/**
 * Ensure the POS_RETURN print template exists. Targeted and idempotent — run it
 * as often as you like.
 *
 *   pnpm tsx prisma/seeds/ensure-pos-return-template.ts
 *
 * CREATES the row once, as a copy of the shop's POS receipt template (same
 * header, logo, footer and toggles) so the counter's return slip carries the
 * branding the owner already set up. The copy gets its own sub-title and drops
 * the POS terms ("Sold items cannot be returned" makes no sense on a return).
 * A row that is already there is never touched — it is the owner's to edit on
 * Print Templates.
 */

import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as dotenv from "dotenv";
import { buildVoucherTemplateDefaults } from "../../src/shared/lib/print/voucherTemplateDefaults";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

// Same connection dance as the other seed scripts: the app's shared client is
// configured for the server and does not start in a CLI.
const rawUrl = (process.env.DIRECT_URL_1 ?? process.env.DATABASE_URL_1 ?? "")
    .replace(/[?&]sslmode=[^&]*/g, "")
    .replace(/[?&]$/, "");
const pool = new Pool({
    connectionString: rawUrl,
    ssl: /@(localhost|127\.0\.0\.1)/.test(rawUrl) ? false : { rejectUnauthorized: false },
    max: 2,
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
    if (await prisma.voucherPrintTemplate.findUnique({ where: { kind: "POS_RETURN" } })) {
        console.log("POS_RETURN template already there — left as it is.");
        return;
    }
    const defaults = buildVoucherTemplateDefaults("POS_RETURN");
    const pos = await prisma.voucherPrintTemplate.findUnique({ where: { kind: "POS" } });
    const data = pos
        ? {
            ...pos,
            kind:         "POS_RETURN",
            headerLine2:  defaults.headerLine2,
            termsText:    "",
            footerLine:   pos.footerLine || defaults.footerLine,
            defaultPaper: defaults.defaultPaper,
        }
        : defaults;
    await prisma.voucherPrintTemplate.create({ data });
    console.log(`POS_RETURN template created${pos ? " from the POS receipt template" : " from code defaults"}.`);
}

main()
    .catch((e) => { console.error(e); process.exitCode = 1; })
    .finally(async () => { await prisma.$disconnect(); await pool.end(); });
