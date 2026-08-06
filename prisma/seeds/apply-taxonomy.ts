/**
 * Taxonomy backfill — builds the product group tree and auto-classifies the
 * catalog's group + brand from product names, then strips junk name prefixes.
 *
 * WHY: the catalog had 1,413 products of which only 56 carried a group and 5 a
 * brand, so every downstream feature that keys off them (storefront browse, the
 * pricing-strategy chain BRAND → GROUP → CATEGORY → ORG, reorder movement bands,
 * loyalty/coupon rules) was inert. The classification signal is in the product
 * name, which is reliably shaped "<TYPE> <brand> <spec…>".
 *
 * MATCHING IS TWO-PASS AND THAT IS LOAD-BEARING. Pass 1 matches only the HEAD
 * (first 3 words); pass 2 falls back to an anywhere-match. A flat anywhere-match
 * mis-files badly, because the spec tail is full of decoy nouns:
 *     "Laptop Dell i5-8th gen/ 8gb/ 512gb SSD"  →  would hit \bssd\b  → Storage
 *     "DDR3 4GB Daichi Laptop Ram"              →  would hit \blaptop\b → Laptop
 *     "CPU Fan Ant Esports ICE C400"            →  would hit \bcpu\b   → CPU
 * Head-noun-first fixes all three. Pass-2 hits are reported separately because
 * they are the low-confidence ones.
 *
 * Idempotent and NON-DESTRUCTIVE: only ever fills fields that are currently
 * NULL. A product that already has a group or brand is never touched, so manual
 * corrections survive re-runs.
 *
 * Run: npx tsx prisma/seeds/apply-taxonomy.ts --dry   (preview, writes nothing)
 *      npx tsx prisma/seeds/apply-taxonomy.ts          (apply)
 */
import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "").replace(/[?&]sslmode=[^&]*/g, "");
const pool = new Pool({ connectionString: rawUrl, ssl: /@(localhost|127\.0\.0\.1)/.test(rawUrl) ? false : { rejectUnauthorized: false } });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const DRY = process.argv.includes("--dry");

// ─────────────────────────────────────────────────────────────────────────────
// TARGET TREE. Indentation = depth. Existing groups are matched by (name,parent)
// and left alone; missing ones are created.
// ─────────────────────────────────────────────────────────────────────────────
const TREE = `
CCTV & Surveillance
  HD CCTV
    HD Bullet
    HD Dome
  IP CCTV
    IP Bullet
    IP Dome
  Standalone Cameras / 360
  DVR & NVR
  CCTV Accessories
IT Products
  Keyboard
  Monitor
  Mouse
  Laptop
  Laptop Accessories
  Desktop & CPU
  Cabinet
  Motherboard
  RAM
  SMPS
  Cooling & Fan
Printers & Consumables
  Printer
  Ink
  Cartridge
  Toner
  Ribbon
Audio & Video
  Earphone
  Headphone
  Speaker
  Microphone
  Webcam
Networking
  Router
  WiFi Adapter
  Network Switch
  Network Cable
Cables & Connectors
  HDMI Cable
  USB Cable
  Data Cable
  Power Cable
  AV & Audio Cable
  Converter & Adapter
  Cable Accessories
Software & Security
  Antivirus
Barcode & POS
  Barcode Scanner
  Barcode Label
  POS Accessories
Mobile & Accessories
  Mobile Charger
  Car Charger
  Power Bank
  Phone
Storage Products
  HDD & SSD
    HDD
    NVME SSD
    SATA SSD
  Memory Card
  Pen Drive
  Card Reader
  Optical Media
Paper & Stationary
  Bond Paper
  Copier Paper
  Lamination Roll
  Photo Paper
  Thermal Paper Toll
  PVC Card
Power Backup and Stablizer
  UPS
  Stabilizer
  Inverter & Battery
`;

// ─────────────────────────────────────────────────────────────────────────────
// RULES — ORDERED, first match wins, within each pass. Comments mark the
// orderings that are load-bearing (removing them reintroduces a known misfile).
// ─────────────────────────────────────────────────────────────────────────────
const RULES: Array<[RegExp, string]> = [
    // Software first — "Total Security" would otherwise read as CCTV.
    [/\bantivirus\b|\bantiviruse\b|\bquick\s*heal\b|\binternet\s*security\b|\btotal\s*security\b/i, "Software & Security > Antivirus"],

    // Assembled PCs before storage/RAM/CPU — their spec tails name every part.
    [/\bassembl|\bdesktop\s*comp|\bdesktop\s*pc\b|\ball.in.one\s*pc\b/i, "IT Products > Desktop & CPU"],

    // Laptop ACCESSORIES before \blaptop\b — else bags and pads read as laptops.
    [/\bbag\b|\bbackpack\b|\bsleeve\b/i,            "IT Products > Laptop Accessories"],
    [/\b(keypad|screen)\s*protector\b|\bco?o?l+ing\s*pad\b|\b3d\s*sti?c?ker\b/i, "IT Products > Laptop Accessories"],
    [/\blaptop\b.*\b(battery|cmos|adapter|charger|stand|skin|pad|sti?c?ker|protector)\b|\b(battery|cmos)\b.*\blaptop\b/i, "IT Products > Laptop Accessories"],

    // Barcode & POS before generic scanner/label.
    [/\bbarcode\s*scanner\b|\bscanner\b.*\bbarcode\b/i, "Barcode & POS > Barcode Scanner"],
    [/\bbarcode\s*(label|sticker)\b/i,              "Barcode & POS > Barcode Label"],
    [/\bcash\s*(tray|drawer|box)\b/i,               "Barcode & POS > POS Accessories"],

    // Chargers before the generic cable rules.
    [/\bcar\s*charger\b/i,                          "Mobile & Accessories > Car Charger"],
    [/\bpower\s*bank\b/i,                           "Mobile & Accessories > Power Bank"],
    [/\bcharger\b/i,                                "Mobile & Accessories > Mobile Charger"],
    [/\blandline\b|\bcorded\s*phone\b|\bteleph/i,   "Mobile & Accessories > Phone"],

    // Printer consumables before anything brand-ish ("Ink Canon …").
    [/\bmaintenance\s*box\b/i,                      "Printers & Consumables > Printer"],
    [/\btoner\b/i,                                  "Printers & Consumables > Toner"],
    [/\bcartridge\b/i,                              "Printers & Consumables > Cartridge"],
    [/\bribbon\b/i,                                 "Printers & Consumables > Ribbon"],
    [/\bink\b/i,                                    "Printers & Consumables > Ink"],
    [/\bprinter\b|\bmfp\b|\ball.in.one\b/i,         "Printers & Consumables > Printer"],

    // Paper & stationary
    [/\bpvc\s*card\b/i,                             "Paper & Stationary > PVC Card"],
    [/\blamination\b|\blaminat/i,                   "Paper & Stationary > Lamination Roll"],
    [/\bphoto\s*paper\b/i,                          "Paper & Stationary > Photo Paper"],
    [/\bthermal\s*(paper|roll|toll)\b/i,            "Paper & Stationary > Thermal Paper Toll"],
    [/\bbond\s*paper\b/i,                           "Paper & Stationary > Bond Paper"],
    [/\bcopier\s*paper\b|\bpaper\s*a4\b|\ba4\b.*\bsheet/i, "Paper & Stationary > Copier Paper"],

    // CCTV
    [/\bnvr\b|\bdvr\b|\bxvr\b/i,                    "CCTV & Surveillance > DVR & NVR"],
    [/\bip\b.*\bbullet\b|\bbullet\b.*\bip\b/i,      "CCTV & Surveillance > IP CCTV > IP Bullet"],
    [/\bip\b.*\bdome\b|\bdome\b.*\bip\b/i,          "CCTV & Surveillance > IP CCTV > IP Dome"],
    [/\bbullet\b/i,                                 "CCTV & Surveillance > HD CCTV > HD Bullet"],
    [/\bdome\b/i,                                   "CCTV & Surveillance > HD CCTV > HD Dome"],
    [/\b360\b|\bptz\b|\bstandalone\s*cam/i,         "CCTV & Surveillance > Standalone Cameras / 360"],
    [/\bbnc\b|\bpigtail\b/i,                        "CCTV & Surveillance > CCTV Accessories"],
    [/\bcctv\b|\bcamera\b/i,                        "CCTV & Surveillance > CCTV Accessories"],

    // Storage
    [/\bnvme\b|\bm\.?2\b/i,                         "Storage Products > HDD & SSD > NVME SSD"],
    [/\bssd\b/i,                                    "Storage Products > HDD & SSD > SATA SSD"],
    [/\bhdd\b|\bhard\s*dis[kc]\b|\bhard\s*drive\b/i,"Storage Products > HDD & SSD > HDD"],
    [/\bpen\s*drive\b|\bpendrive\b|\bflash\s*drive\b/i, "Storage Products > Pen Drive"],
    [/\bmemory\s*card\b|\bmicro\s*sd\b|\bsd\s*card\b/i, "Storage Products > Memory Card"],
    [/\bcard\s*reader\b/i,                          "Storage Products > Card Reader"],
    [/\bcdr\b|\bdvdr?\b|\bblu.?ray\b/i,             "Storage Products > Optical Media"],

    // Audio & video
    [/\bairdopes\b|\bairpod|\btws\b|\bearphone\b|\bearbud|\bear\s*phone\b|\bneckband\b/i, "Audio & Video > Earphone"],
    [/\bheadphone\b|\bhead\s*phone\b|\bheadset\b/i, "Audio & Video > Headphone"],
    [/\bspeaker\b|\bsound\s*bar\b|\bwoofer\b/i,     "Audio & Video > Speaker"],
    [/\bmic\b|\bmicrophone\b/i,                     "Audio & Video > Microphone"],
    [/\bwebcam\b|\bweb\s*cam\b/i,                   "Audio & Video > Webcam"],

    // Networking
    [/\brouter\b/i,                                 "Networking > Router"],
    [/\bwifi\b|\bwi.fi\b|\bwireless\s*adapter\b|\bdongle\b/i, "Networking > WiFi Adapter"],
    [/\bswitch\b|\bpoe\b/i,                         "Networking > Network Switch"],
    [/\bcat\s*6\b|\bcat6\b|\bcat\s*5\b|\blan\s*cable\b|\bpatch\s*cord\b/i, "Networking > Network Cable"],

    // Cables & connectors
    [/\bhdmi\b/i,                                   "Cables & Connectors > HDMI Cable"],
    [/\baux\b|\brca\b|\bav\s*(cable|jack)\b|\bdisplay\s*port\b|\bdp\s*to\s*dp\b|\bvga\b|\blvds\b/i, "Cables & Connectors > AV & Audio Cable"],
    [/\bdata\s*cable\b/i,                           "Cables & Connectors > Data Cable"],
    [/\bpower\s*(cable|cord)\b/i,                   "Cables & Connectors > Power Cable"],
    [/\bcable\s*(tie|clip)\b|\bcrimp\b|\bconnector\b|\brj\d+\b|\bmodular\s*plug\b/i, "Cables & Connectors > Cable Accessories"],
    [/\bconverter\b|\bextension\b/i,                "Cables & Connectors > Converter & Adapter"],
    [/\busb\b/i,                                    "Cables & Connectors > USB Cable"],
    [/\badapter\b|\badaptor\b/i,                    "Cables & Connectors > Converter & Adapter"],
    [/\bfiber\s*optic\b|\bpatch\s*cod\b|\bcable\b/i,"Cables & Connectors > Cable Accessories"],

    // IT products
    [/\bkeyboard\b/i,                               "IT Products > Keyboard"],
    [/\bmouse\b/i,                                  "IT Products > Mouse"],
    [/\bmonitor\b|\bled\s*display\b/i,              "IT Products > Monitor"],
    [/\blaptop\b|\bnotebook\b/i,                    "IT Products > Laptop"],
    [/\bcabinet\b/i,                                "IT Products > Cabinet"],
    [/\bsmps\b|\bpower\s*supply\b/i,                "IT Products > SMPS"],
    [/\bddr\d\b|\bram\b|\bdimm\b/i,                 "IT Products > RAM"],
    [/\bmotherboard\b|\bmother\s*board\b|\bmb\b/i,  "IT Products > Motherboard"],
    // Cooling before CPU — "CPU Fan …" is a fan, not a processor.
    [/\bfan\b|\bcooler\b|\bheat\s*sink\b/i,         "IT Products > Cooling & Fan"],
    [/\bcpu\b|\bprocessor\b|\bi[3579]\b|\bryzen\b/i,"IT Products > Desktop & CPU"],

    // Power
    [/\bups\b/i,                                    "Power Backup and Stablizer > UPS"],
    [/\bstabili[sz]er\b/i,                          "Power Backup and Stablizer > Stabilizer"],
    [/\binverter\b|\bbattery\b/i,                   "Power Backup and Stablizer > Inverter & Battery"],
];

const headOf = (name: string) => name.replace(/^[-\s]+/, "").split(/\s+/).slice(0, 3).join(" ");

function classify(name: string): { path: string; pass: 1 | 2 } | null {
    const head = headOf(name);
    for (const [re, path] of RULES) if (re.test(head)) return { path, pass: 1 };
    for (const [re, path] of RULES) if (re.test(name)) return { path, pass: 2 };
    return null;
}

/** Parse the indented TREE into [path, depth] pairs in document order. */
function parseTree(): string[] {
    const stack: string[] = [];
    const paths: string[] = [];
    for (const raw of TREE.trim().split("\n")) {
        const depth = Math.floor((raw.length - raw.trimStart().length) / 2);
        const name = raw.trim();
        stack.length = depth;
        stack.push(name);
        paths.push(stack.join(" > "));
    }
    return paths;
}

async function ensureTree(): Promise<Map<string, number>> {
    const ids = new Map<string, number>();
    let created = 0;
    const moved: string[] = [];

    for (const path of parseTree()) {
        const parts = path.split(" > ");
        const name = parts[parts.length - 1]!;
        const parentId = parts.length > 1 ? ids.get(parts.slice(0, -1).join(" > ")) ?? null : null;

        // Look up by NAME ALONE. InvProductGroup carries @@unique([name]) — group
        // names are globally unique, NOT unique-per-parent — so a name can exist
        // only once in the whole tree. Keying the lookup on (name, parentId)
        // silently misses a same-named group sitting elsewhere and then dies on
        // the unique constraint at create time.
        const existing = await prisma.invProductGroup.findUnique({ where: { name } });

        if (existing) {
            ids.set(path, existing.id);
            // Same name, wrong place: adopt it into the intended position rather
            // than leaving a stray root. Uniqueness guarantees this is the only
            // group by that name, so re-parenting is unambiguous.
            if (existing.parentId !== parentId) {
                moved.push(`${name} (parent ${existing.parentId ?? "root"} → ${parentId ?? "root"})`);
                if (!DRY) await prisma.invProductGroup.update({ where: { id: existing.id }, data: { parentId } });
            }
            continue;
        }

        if (DRY) { ids.set(path, -1 - created); created++; continue; }
        const row = await prisma.invProductGroup.create({ data: { name, parentId, isActive: true } });
        ids.set(path, row.id);
        created++;
    }

    console.log(`  groups: ${ids.size} total, ${created} ${DRY ? "would be created" : "created"}`);
    if (moved.length) {
        console.log(`  ⇄ ${moved.length} existing group(s) re-parented into the tree:`);
        moved.forEach((m) => console.log(`      ${m}`));
    }
    return ids;
}

async function main() {
    console.log(`\n${DRY ? "🔍 DRY RUN — nothing will be written." : "✍️  APPLYING taxonomy backfill."}\n`);

    console.log("[1/4] Group tree…");
    const groupIds = await ensureTree();

    const products = await prisma.invProduct.findMany({
        select: { id: true, name: true, namePart: true, groupId: true, brandId: true },
        orderBy: { id: "asc" },
    });

    // ── [2] Group classification ──────────────────────────────────────────────
    console.log("\n[2/4] Classifying groups…");
    const toGroup = new Map<number, number[]>(); // groupId → productIds
    let pass2 = 0, unmatched = 0, skipped = 0;
    for (const p of products) {
        if (p.groupId !== null) { skipped++; continue; }
        const hit = classify(p.name);
        if (!hit) { unmatched++; continue; }
        const gid = groupIds.get(hit.path);
        if (gid === undefined) throw new Error(`Rule targets unknown group path: "${hit.path}"`);
        if (hit.pass === 2) pass2++;
        const arr = toGroup.get(gid) ?? [];
        arr.push(p.id);
        toGroup.set(gid, arr);
    }
    const grouped = [...toGroup.values()].reduce((s, a) => s + a.length, 0);
    console.log(`  ${grouped} classified (${grouped - pass2} head-noun, ${pass2} anywhere-match)`);
    console.log(`  ${skipped} already grouped (untouched) · ${unmatched} unmatched (left NULL for manual triage)`);
    if (!DRY) {
        for (const [gid, pids] of toGroup) {
            await prisma.invProduct.updateMany({ where: { id: { in: pids } }, data: { groupId: gid } });
        }
    }

    // ── [3] Brand classification ──────────────────────────────────────────────
    console.log("\n[3/4] Classifying brands…");
    const brands = await prisma.invBrand.findMany({ select: { id: true, name: true } });
    brands.sort((a, b) => b.name.length - a.name.length); // longest name wins
    const toBrand = new Map<number, number[]>();
    for (const p of products) {
        if (p.brandId !== null) continue;
        const hit = brands.find((b) =>
            new RegExp(`\\b${b.name.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")}\\b`, "i").test(p.name)
        );
        if (!hit) continue;
        const arr = toBrand.get(hit.id) ?? [];
        arr.push(p.id);
        toBrand.set(hit.id, arr);
    }
    const branded = [...toBrand.values()].reduce((s, a) => s + a.length, 0);
    console.log(`  ${branded} brands assigned from name`);
    if (!DRY) {
        for (const [bid, pids] of toBrand) {
            await prisma.invProduct.updateMany({ where: { id: { in: pids } }, data: { brandId: bid } });
        }
    }

    // ── [4] Junk name prefix ──────────────────────────────────────────────────
    // An import left a literal "- " on the front of names AND of namePart (the
    // curated free-text portion), so regenerating the name would not clear it.
    console.log("\n[4/4] Stripping junk \"- \" name prefixes…");
    const dashed = products.filter((p) => /^\s*-\s+/.test(p.name));
    console.log(`  ${dashed.length} names ${DRY ? "would be" : ""} cleaned`);
    if (!DRY) {
        for (const p of dashed) {
            await prisma.invProduct.update({
                where: { id: p.id },
                data: {
                    name: p.name.replace(/^\s*-\s+/, ""),
                    ...(p.namePart ? { namePart: p.namePart.replace(/^\s*-\s+/, "") } : {}),
                },
            });
        }
    }

    console.log(`\n${DRY ? "🔍 DRY RUN complete — nothing written." : "✅ Applied."}\n`);
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(async () => { await prisma.$disconnect(); await pool.end(); });
