import { createHash } from "node:crypto";
import { prisma } from "../packages/db/src/index.js";

const sinceMinutes = Math.max(1, Math.min(24 * 60, Number(process.env.BEAUTY_AUDIT_SINCE_MINUTES ?? "180")));
const since = new Date(Date.now() - sinceMinutes * 60_000);
const hash = (value: string | null | undefined) => value
  ? createHash("sha256").update(value).digest("hex").slice(0, 16)
  : null;

async function main(): Promise<void> {
  const reservations = await prisma.creditReservation.findMany({
    where: {
      productCode: "beauty-industry",
      createdAt: { gte: since },
      status: "released"
    },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: {
      id: true,
      tenantId: true,
      userId: true,
      requestId: true,
      requestFingerprint: true,
      amount: true,
      actualAmount: true,
      status: true,
      errorCode: true,
      channel: true,
      createdAt: true,
      updatedAt: true
    }
  });
  const evidence = [];
  for (const reservation of reservations) {
    const transactions = await prisma.creditTransaction.findMany({
      where: { refType: "credit_reservation", refId: reservation.id },
      select: { direction: true, amount: true, reason: true, capabilityId: true },
      orderBy: { createdAt: "asc" }
    });
    const agentRunCount = reservation.requestFingerprint
      ? await prisma.agentRun.count({
          where: { tenantId: reservation.tenantId, requestFingerprint: reservation.requestFingerprint }
        })
      : 0;
    evidence.push({
      reservationHash: hash(reservation.id),
      tenantHash: hash(reservation.tenantId),
      userHash: hash(reservation.userId),
      requestHash: hash(reservation.requestId),
      fingerprintPrefix: reservation.requestFingerprint?.slice(0, 16) ?? null,
      amount: reservation.amount,
      actualAmount: reservation.actualAmount,
      status: reservation.status,
      errorCode: reservation.errorCode,
      channel: reservation.channel,
      ageSeconds: Math.max(0, Math.round((Date.now() - reservation.createdAt.getTime()) / 1000)),
      durationMs: reservation.updatedAt.getTime() - reservation.createdAt.getTime(),
      transactions,
      agentRunCount
    });
  }
  process.stdout.write(`${JSON.stringify({ sinceMinutes, releasedCount: evidence.length, evidence }, null, 2)}\n`);
}

main().finally(async () => prisma.$disconnect()).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
