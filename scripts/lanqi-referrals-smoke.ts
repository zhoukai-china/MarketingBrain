import assert from "node:assert/strict";
import {
  buildLanqiReferralInvite,
  claimLanqiReferral,
  publicLanqiReferral,
} from "../apps/api/src/services/lanqi-referrals.ts";

const invite = buildLanqiReferralInvite("lq-test-referral-code", "首批试点");
assert.equal(invite.invite.maxUses, 1);
assert.equal(invite.invite.codeHash.length, 64);
assert.notEqual(invite.invite.codeHash, invite.plainCode);

const record = {
  id: "referral-a",
  inviterTenantId: "franchisee-a",
  inviteCodeId: "invite-a",
  referredTenantId: "store-a",
  status: "claimed" as const,
  label: "首批试点",
  createdAt: new Date("2026-08-13T00:00:00.000Z"),
  claimedAt: new Date("2026-08-13T01:00:00.000Z"),
};
const publicRecord = publicLanqiReferral(record);
assert.deepEqual(publicRecord, {
  id: "referral-a",
  label: "首批试点",
  status: "claimed",
  createdAt: "2026-08-13T00:00:00.000Z",
  claimedAt: "2026-08-13T01:00:00.000Z",
});
assert.equal("referredTenantId" in publicRecord, false);

const stored = { ...record, referredTenantId: null as string | null, status: "pending" as const, claimedAt: null as Date | null };
const tx = {
  lanqiReferral: {
    async findUnique() { return { ...stored }; },
    async updateMany({ where, data }: any) {
      if (where.id !== stored.id || where.status !== stored.status || where.referredTenantId !== stored.referredTenantId) return { count: 0 };
      stored.status = data.status;
      stored.referredTenantId = data.referredTenantId;
      stored.claimedAt = data.claimedAt;
      return { count: 1 };
    },
  },
};
async function main() {
  assert.equal(await claimLanqiReferral({ inviteCodeId: "invite-a", referredTenantId: "store-a" }, tx), "claimed");
  assert.equal(await claimLanqiReferral({ inviteCodeId: "invite-a", referredTenantId: "store-b" }, tx), "already_claimed");
  assert.equal(await claimLanqiReferral({ inviteCodeId: "invite-a", referredTenantId: "franchisee-a" }, {
    lanqiReferral: { async findUnique() { return { ...record, referredTenantId: null, status: "pending" }; } },
  }), "self_referral");
  console.log("Lanqi referrals smoke passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
