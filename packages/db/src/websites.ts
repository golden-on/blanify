import { and, eq, or } from "drizzle-orm";
import { db } from "./client";
import { hostedWebsites, websitePages } from "./schema";

export async function resolveWebsiteByDomain(domain: string) {
  const [website] = await db
    .select()
    .from(hostedWebsites)
    .where(or(eq(hostedWebsites.subdomain, domain), eq(hostedWebsites.customDomain, domain)));
  return website;
}

export async function resolvePage(websiteId: string, slug: string) {
  const [page] = await db
    .select()
    .from(websitePages)
    .where(and(eq(websitePages.websiteId, websiteId), eq(websitePages.slug, slug)));
  return page;
}
