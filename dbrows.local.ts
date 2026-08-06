import * as dotenv from "dotenv";
import { Client } from "pg";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("no url");
const parsed = new URL(url);
parsed.searchParams.delete("sslmode");
const c = new Client({ connectionString: parsed.toString(), ssl: { rejectUnauthorized: false } });
(async () => {
  await c.connect();
  console.log("LIVE HOST:", parsed.host, "| project ref:", parsed.username);
  for (const t of ["Account","Person","UniversalVoucher","InvProduct","User","Ticket"]) {
    const r = await c.query(`SELECT count(*)::int AS n FROM public."${t}"`);
    console.log(`${t.padEnd(20)} ${r.rows[0].n}`);
  }
  await c.end();
})().catch(e => { console.error("FAILED:", e.message); process.exit(1); });
