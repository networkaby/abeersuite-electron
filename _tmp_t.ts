import { prisma } from "./src/shared/lib/prisma/prismaClient";
async function main() {
  const row = await prisma.voucherPrintTemplate.findUnique({
    where: { kind: "SHIPPING_SLIP" },
    select: {
      showSentBy: true, showSentByThermal: true,
      showReceivedBy: true, showReceivedByThermal: true,
      showPreparedBy: true, showPreparedByThermal: true,
      showFindings: true, showFindingsThermal: true,
    },
  });
  console.log("NOW:", JSON.stringify(row));
  await prisma.$disconnect();
}
main().catch((e) => { console.log("ERR:", e.message); process.exit(1); });
