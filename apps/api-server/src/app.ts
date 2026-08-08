import Fastify, { type FastifyInstance } from "fastify";
import { registerWebhookRoutes } from "./routes/webhooks";

declare module "fastify" {
  interface FastifyRequest {
    rawBody?: string;
  }
}

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: true });

  // Signature verification needs the exact raw bytes, not Fastify's re-serialized JSON.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
    const raw = body as string;
    request.rawBody = raw;
    try {
      done(null, raw === "" ? {} : JSON.parse(raw));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  app.get("/health", async () => {
    return { status: "ok" };
  });

  app.register(registerWebhookRoutes);

  return app;
}
