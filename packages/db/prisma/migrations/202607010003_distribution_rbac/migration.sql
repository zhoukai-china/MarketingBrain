-- CreateTable Distributor
CREATE TABLE "Distributor" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "level" INTEGER NOT NULL DEFAULT 1,
    "parentId" TEXT,
    "code" TEXT NOT NULL,
    "totalEarnings" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "frozenAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "availableAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalWithdrawn" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "statsJson" JSONB,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Distributor_pkey" PRIMARY KEY ("id")
);

-- CreateTable DistroCustomer
CREATE TABLE "DistroCustomer" (
    "id" TEXT NOT NULL,
    "distributorId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "customerType" TEXT NOT NULL DEFAULT 'user',
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "totalOrders" INTEGER NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalCommission" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "source" TEXT,
    "tags" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DistroCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable DistroOrder
CREATE TABLE "DistroOrder" (
    "id" TEXT NOT NULL,
    "distributorId" TEXT NOT NULL,
    "distroCustomerId" TEXT NOT NULL,
    "orderId" TEXT,
    "orderType" TEXT NOT NULL DEFAULT 'product',
    "amount" DECIMAL(12,2) NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DistroOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable DistroCommissionLog
CREATE TABLE "DistroCommissionLog" (
    "id" TEXT NOT NULL,
    "distributorId" TEXT NOT NULL,
    "distroOrderId" TEXT,
    "sourceDistributorId" TEXT,
    "withdrawalId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "rate" DECIMAL(10,4) NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "type" TEXT NOT NULL DEFAULT 'direct',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "description" TEXT,
    "unfrozenAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DistroCommissionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable DistroWithdrawal
CREATE TABLE "DistroWithdrawal" (
    "id" TEXT NOT NULL,
    "distributorId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "actualAmount" DECIMAL(12,2) NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'wechat',
    "accountInfo" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "remark" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DistroWithdrawal_pkey" PRIMARY KEY ("id")
);

-- CreateTable CommissionRule
CREATE TABLE "CommissionRule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "rate" DECIMAL(10,4) NOT NULL,
    "minAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "maxAmount" DECIMAL(12,2),
    "productTag" TEXT,
    "unfreezeDays" INTEGER NOT NULL DEFAULT 7,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable ShareLink
CREATE TABLE "ShareLink" (
    "id" TEXT NOT NULL,
    "distributorId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'wechat',
    "title" TEXT,
    "imageUrl" TEXT,
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "registerCount" INTEGER NOT NULL DEFAULT 0,
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShareLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable RiskRule
CREATE TABLE "RiskRule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "threshold" INTEGER NOT NULL,
    "windowSeconds" INTEGER NOT NULL DEFAULT 3600,
    "action" TEXT NOT NULL DEFAULT 'log',
    "config" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiskRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable RiskEvent
CREATE TABLE "RiskEvent" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "detail" TEXT,
    "ip" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable AuditLog
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "resourceId" TEXT,
    "detail" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable Role
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "scope" TEXT NOT NULL DEFAULT 'platform',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable Permission
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable RolePermission
CREATE TABLE "RolePermission" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "effect" TEXT NOT NULL DEFAULT 'allow',

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable UserRoleAssignment
CREATE TABLE "UserRoleAssignment" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "UserRoleAssignment_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable AccessPolicy
CREATE TABLE "AccessPolicy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "effect" TEXT NOT NULL DEFAULT 'allow',
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "condition" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccessPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable RolePolicy
CREATE TABLE "RolePolicy" (
    "roleId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,

    CONSTRAINT "RolePolicy_pkey" PRIMARY KEY ("roleId","policyId")
);

-- CreateTable SsoConfig
CREATE TABLE "SsoConfig" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecret" TEXT,
    "issuerUrl" TEXT,
    "redirectUri" TEXT,
    "scopes" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SsoConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Distributor_code_key" ON "Distributor"("code");

-- CreateIndex
CREATE INDEX "Distributor_tenantId_code_idx" ON "Distributor"("tenantId", "code");

-- CreateIndex
CREATE INDEX "Distributor_parentId_idx" ON "Distributor"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "Distributor_tenantId_userId_key" ON "Distributor"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "DistroCustomer_customerId_customerType_idx" ON "DistroCustomer"("customerId", "customerType");

-- CreateIndex
CREATE UNIQUE INDEX "DistroCustomer_distributorId_customerId_customerType_key" ON "DistroCustomer"("distributorId", "customerId", "customerType");

-- CreateIndex
CREATE INDEX "DistroOrder_distributorId_createdAt_idx" ON "DistroOrder"("distributorId", "createdAt");

-- CreateIndex
CREATE INDEX "DistroOrder_distroCustomerId_idx" ON "DistroOrder"("distroCustomerId");

-- CreateIndex
CREATE INDEX "DistroOrder_orderId_idx" ON "DistroOrder"("orderId");

-- CreateIndex
CREATE INDEX "DistroCommissionLog_distributorId_createdAt_idx" ON "DistroCommissionLog"("distributorId", "createdAt");

-- CreateIndex
CREATE INDEX "DistroCommissionLog_distroOrderId_idx" ON "DistroCommissionLog"("distroOrderId");

-- CreateIndex
CREATE INDEX "DistroCommissionLog_withdrawalId_idx" ON "DistroCommissionLog"("withdrawalId");

-- CreateIndex
CREATE INDEX "DistroWithdrawal_distributorId_status_createdAt_idx" ON "DistroWithdrawal"("distributorId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionRule_tenantId_level_productTag_key" ON "CommissionRule"("tenantId", "level", "productTag");

-- CreateIndex
CREATE UNIQUE INDEX "ShareLink_code_key" ON "ShareLink"("code");

-- CreateIndex
CREATE INDEX "ShareLink_distributorId_idx" ON "ShareLink"("distributorId");

-- CreateIndex
CREATE INDEX "ShareLink_tenantId_code_idx" ON "ShareLink"("tenantId", "code");

-- CreateIndex
CREATE INDEX "ShareLink_code_idx" ON "ShareLink"("code");

-- CreateIndex
CREATE INDEX "RiskRule_tenantId_type_idx" ON "RiskRule"("tenantId", "type");

-- CreateIndex
CREATE INDEX "RiskEvent_ruleId_createdAt_idx" ON "RiskEvent"("ruleId", "createdAt");

-- CreateIndex
CREATE INDEX "RiskEvent_tenantId_type_createdAt_idx" ON "RiskEvent"("tenantId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_resource_resourceId_idx" ON "AuditLog"("resource", "resourceId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Role_tenantId_name_scope_key" ON "Role"("tenantId", "name", "scope");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_resource_action_key" ON "Permission"("resource", "action");

-- CreateIndex
CREATE UNIQUE INDEX "SsoConfig_tenantId_provider_key" ON "SsoConfig"("tenantId", "provider");

-- AddForeignKey
ALTER TABLE "Distributor" ADD CONSTRAINT "Distributor_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Distributor" ADD CONSTRAINT "Distributor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Distributor" ADD CONSTRAINT "Distributor_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Distributor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DistroCustomer" ADD CONSTRAINT "DistroCustomer_distributorId_fkey" FOREIGN KEY ("distributorId") REFERENCES "Distributor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DistroOrder" ADD CONSTRAINT "DistroOrder_distributorId_fkey" FOREIGN KEY ("distributorId") REFERENCES "Distributor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DistroOrder" ADD CONSTRAINT "DistroOrder_distroCustomerId_fkey" FOREIGN KEY ("distroCustomerId") REFERENCES "DistroCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DistroCommissionLog" ADD CONSTRAINT "DistroCommissionLog_distributorId_fkey" FOREIGN KEY ("distributorId") REFERENCES "Distributor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DistroCommissionLog" ADD CONSTRAINT "DistroCommissionLog_sourceDistributorId_fkey" FOREIGN KEY ("sourceDistributorId") REFERENCES "Distributor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DistroCommissionLog" ADD CONSTRAINT "DistroCommissionLog_distroOrderId_fkey" FOREIGN KEY ("distroOrderId") REFERENCES "DistroOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DistroCommissionLog" ADD CONSTRAINT "DistroCommissionLog_withdrawalId_fkey" FOREIGN KEY ("withdrawalId") REFERENCES "DistroWithdrawal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DistroWithdrawal" ADD CONSTRAINT "DistroWithdrawal_distributorId_fkey" FOREIGN KEY ("distributorId") REFERENCES "Distributor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionRule" ADD CONSTRAINT "CommissionRule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareLink" ADD CONSTRAINT "ShareLink_distributorId_fkey" FOREIGN KEY ("distributorId") REFERENCES "Distributor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareLink" ADD CONSTRAINT "ShareLink_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskRule" ADD CONSTRAINT "RiskRule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskEvent" ADD CONSTRAINT "RiskEvent_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "RiskRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskEvent" ADD CONSTRAINT "RiskEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskEvent" ADD CONSTRAINT "RiskEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRoleAssignment" ADD CONSTRAINT "UserRoleAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRoleAssignment" ADD CONSTRAINT "UserRoleAssignment_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessPolicy" ADD CONSTRAINT "AccessPolicy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePolicy" ADD CONSTRAINT "RolePolicy_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePolicy" ADD CONSTRAINT "RolePolicy_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "AccessPolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SsoConfig" ADD CONSTRAINT "SsoConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
