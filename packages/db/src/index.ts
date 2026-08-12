import { PrismaClient, Prisma } from "@prisma/client";

export { Prisma };

declare global {
  // eslint-disable-next-line no-var
  var SitongPrisma: PrismaClient | undefined;
}

export const prisma =
  globalThis.SitongPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"]
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.SitongPrisma = prisma;
}
