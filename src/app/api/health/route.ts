import { prisma } from "@/lib/db";
import { createHealthHandler } from "@/lib/health";

export const GET = createHealthHandler(async () => {
  await prisma().$queryRawUnsafe("SELECT 1");
});
