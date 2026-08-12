import type { FastifyInstance } from "fastify";
import { resolveRequestContext } from "../services/request-context.js";

export async function registerWorkbenchRoutes(app: FastifyInstance): Promise<void> {
  app.get("/workbench/summary", async (request, reply) => {
    const auth = await resolveRequestContext(request.headers);
    return {
      tenantId: auth.tenantId,
      dataMode: auth.source,
      enabled: true,
      capabilities: {
        fileAnalysis: true,
        audioCardAnalysis: true,
        reportExport: true
      }
    };
  });
}
