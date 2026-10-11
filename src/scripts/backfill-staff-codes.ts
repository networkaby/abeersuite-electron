import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

async function main(): Promise<void> {
    const { prisma } = await import("@/shared/lib/prisma/prismaClient");

    const profiles = await prisma.staffProfile.findMany({
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { userId: "asc" },
    });

    console.log(`Checking ${profiles.length} staff profiles...`);

    const seedMap: Record<string, string> = {
        "admin@networkservice.in": "EMP-786",
        "prokash@networkservice.in": "EMP-787",
        "naba@networkservice.in": "EMP-788",
    };

    async function getNextCode(): Promise<string> {
        const all = await prisma.staffProfile.findMany({
            where: { staffCode: { not: null } },
            select: { staffCode: true },
        });
        let max = 785;
        for (const p of all) {
            if (!p.staffCode) continue;
            const match = p.staffCode.match(/^EMP-(\d+)$/i);
            if (match) {
                const num = parseInt(match[1], 10);
                if (!isNaN(num) && num > max) max = num;
            }
        }
        return `EMP-${max + 1}`;
    }

    let updated = 0;
    for (const p of profiles) {
        if (p.staffCode) {
            console.log(`  User ${p.userId} (${p.user.name}): already has staffCode "${p.staffCode}"`);
            continue;
        }

        const targetCode = seedMap[p.user.email] ?? (await getNextCode());
        await prisma.staffProfile.update({
            where: { userId: p.userId },
            data: { staffCode: targetCode },
        });
        console.log(`  User ${p.userId} (${p.user.name}): assigned staffCode "${targetCode}"`);
        updated++;
    }

    console.log(`\nDone. Updated ${updated} staff profiles.`);
    process.exit(0);
}

main().catch((e) => {
    console.error("Backfill failed:", e);
    process.exit(1);
});
