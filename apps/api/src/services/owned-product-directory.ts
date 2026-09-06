import { prisma } from '@baolu/db';
import type { RequestContext } from './request-context.js';
import { resolveBeautyIndustryBrandContext } from '../products/beauty-industry/brand-config.js';
import { LANQI_BEAUTY_BRAND_PACKAGE } from '../products/beauty-industry/brand-packages/lanqi.js';

/** Display hints only. Every destination continues to enforce its own product guard. */
export async function ownedProductDirectory(context: RequestContext) {
  const rows = context.source === 'database' ? await prisma.tenantProductEntitlement.findMany({
    where: { tenantId: context.tenantId, status: 'active', OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    select: { productCode: true }
  }) : [];
  const products = new Set(rows.map(row => row.productCode));
  const beautyAllowed = context.source !== 'database' || products.has('beauty-industry');
  const brand = beautyAllowed ? resolveBeautyIndustryBrandContext(context.profile.data).config : undefined;
  return {
    beautyAllowed,
    beautyName: brand?.displayName,
    // A legacy product entitlement is distinct from a beauty-industry brand assignment.
    entries: products.has('lanqi') ? [{
      productCode: 'lanqi', name: `${LANQI_BEAUTY_BRAND_PACKAGE.displayName} AI`,
      description: '进入已开通产品的经营档案与工作台。', path: '/lanqi/store-profile'
    }] : []
  };
}
