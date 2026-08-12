import { Prisma } from "@baolu/db";

export function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

export function toPrismaJsonOptional(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  return toPrismaJson(value);
}
