import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prisma } from '../packages/db/src/index.js';
import { ownedProductDirectory } from '../apps/api/src/services/owned-product-directory.js';
import type { RequestContext } from '../apps/api/src/services/request-context.js';

async function main() {
const original = prisma.tenantProductEntitlement.findMany;
let products: string[] = [];
try {
  prisma.tenantProductEntitlement.findMany = (async (query: any) => {
    assert.equal(query.where.tenantId, 'synthetic-owner');
    assert.equal(query.where.status, 'active');
    assert.equal(query.where.OR[0].expiresAt, null);
    assert.ok(query.where.OR[1].expiresAt.gt instanceof Date);
    assert.deepEqual(query.select, { productCode: true });
    return products.map(productCode => ({ productCode }));
  }) as typeof original;
  const context = (brandCode: string) => ({ source: 'database', tenantId: 'synthetic-owner', userId: 'synthetic-user', profile: { tenantName: '兰琪 is not authority', data: { beautyIndustryBrand: { brandCode } } } }) as RequestContext;
  for (let round = 0; round < 3; round++) {
    products = [];
    assert.deepEqual(await ownedProductDirectory(context('lanqi')), { beautyAllowed: false, beautyName: undefined, entries: [] });
    products = ['beauty-industry'];
    assert.equal((await ownedProductDirectory(context('default'))).beautyName, '美业智能体');
    assert.equal((await ownedProductDirectory(context('unknown'))).beautyName, '美业智能体');
    const brand = await ownedProductDirectory(context('lanqi'));
    assert.equal(brand.beautyName, '兰琪'); assert.equal(brand.entries.length, 0);
    products = ['lanqi'];
    const legacy = await ownedProductDirectory(context('default'));
    assert.equal(legacy.beautyAllowed, false); assert.equal(legacy.entries[0]?.path, '/lanqi/store-profile');
    assert.equal(JSON.stringify(legacy).includes('knowledgePackRef'), false);
  }
  prisma.tenantProductEntitlement.findMany = (async () => { throw new Error('fixture-db-unavailable'); }) as typeof original;
  await assert.rejects(ownedProductDirectory(context('lanqi')), /fixture-db-unavailable/);
  const page = readFileSync('apps/web/src/pages/AgentProductsApp.tsx', 'utf8').split('export function MyAiPage()')[1]?.split('export function AccountCenterPage()')[0] ?? '';
  assert.doesNotMatch(page, /lanqiAgentEntry|兰琪|\/lanqi\//);
  assert.match(page, /!error/); assert.match(page, /productEntries/); assert.match(page, /"—"/);
  console.log('owned_product_directory=PASS;rounds=3;brand_not_identity=true;db_error=fail_closed;provider=0');
} finally { prisma.tenantProductEntitlement.findMany = original; await prisma.$disconnect(); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
