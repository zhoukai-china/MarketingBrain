process.env.DATA_MODE = "demo";
process.env.NODE_ENV = "test";

async function main() {
  const { redeemInviteCode } = await import("../apps/api/src/services/invite-codes.js");

  const state = {
    id: "invite_once",
    usedCount: 0,
    maxUses: 1,
    isActive: true,
    expiresAt: null as Date | null
  };
  const redemptions: Array<Record<string, unknown>> = [];

  const transactionClient = {
    inviteCode: {
      async findUnique() {
        await Promise.resolve();
        return { ...state };
      },
      async updateMany({ where, data }: any) {
        await Promise.resolve();
        if (
          where.id !== state.id ||
          where.isActive !== state.isActive ||
          where.usedCount !== state.usedCount
        ) {
          return { count: 0 };
        }
        state.usedCount += data.usedCount.increment;
        return { count: 1 };
      }
    },
    inviteCodeRedemption: {
      async create({ data }: any) {
        redemptions.push(data);
        return data;
      }
    }
  };

  const attempts = await Promise.all(
    ["tenant_a", "tenant_b"].map((tenantId) =>
      redeemInviteCode(
        {
          inviteCodeId: state.id,
          tenantId,
          userId: `user_${tenantId}`,
          planCode: "chain_premium"
        },
        transactionClient
      )
    )
  );

  const ok =
    attempts.filter(Boolean).length === 1 &&
    attempts.filter((value) => !value).length === 1 &&
    state.usedCount === 1 &&
    redemptions.length === 1;

  console.log(
    JSON.stringify(
      {
        ok,
        successfulReservations: attempts.filter(Boolean).length,
        rejectedReservations: attempts.filter((value) => !value).length,
        usedCount: state.usedCount,
        redemptionRecords: redemptions.length
      },
      null,
      2
    )
  );

  if (!ok) {
    throw new Error("One-time invite redemption is not concurrency safe.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
