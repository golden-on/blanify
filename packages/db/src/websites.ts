import { and, eq, or } from "drizzle-orm";
import type { LayoutSchema, Section, ThemeConfig, UpdateSiteRequest } from "@repo/shared-types";
import { db } from "./client";
import { withTenant } from "./tenant-context";
import { hostedWebsites, websitePages, accounts } from "./schema";

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

// The single canonical page a host edits through the Phase 14 builder — matches
// resolveWebsiteQuerySchema's `path` default, so this is the exact page `resolvePage`
// already serves to anonymous visitors of the root path.
const HOME_PAGE_SLUG = "/";

const DEFAULT_THEME: ThemeConfig = { primaryColor: "#0f172a", fontFamily: "Inter" };

export interface SiteConfig {
  id: string;
  slug: string;
  customDomain: string | null;
  primaryColor: string;
  isPublished: boolean;
  updatedAt: Date;
  heroTitle: string;
  heroSubtitle: string;
  featuredUnitIds: string[];
}

function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "")
    .slice(0, 40);
  return base || "site";
}

function extractContent(layoutSchema: LayoutSchema): { heroTitle: string; heroSubtitle: string; featuredUnitIds: string[] } {
  const hero = layoutSchema.find((s): s is Extract<Section, { type: "hero" }> => s.type === "hero");
  const roomCards = layoutSchema.find((s): s is Extract<Section, { type: "room_cards" }> => s.type === "room_cards");
  return {
    heroTitle: hero?.title ?? "",
    heroSubtitle: hero?.subtitle ?? "",
    featuredUnitIds: roomCards?.unitIds ?? [],
  };
}

function toSiteConfig(
  website: typeof hostedWebsites.$inferSelect,
  content: { heroTitle: string; heroSubtitle: string; featuredUnitIds: string[] },
): SiteConfig {
  const theme = website.themeConfig as ThemeConfig;
  return {
    id: website.id,
    slug: website.subdomain,
    customDomain: website.customDomain,
    primaryColor: theme.primaryColor,
    isPublished: website.isPublished,
    updatedAt: website.updatedAt,
    heroTitle: content.heroTitle,
    heroSubtitle: content.heroSubtitle,
    featuredUnitIds: content.featuredUnitIds,
  };
}

// Un-scoped by design (same reasoning as getUserByEmail's un-scoped lookup): subdomains
// must be unique across every tenant, and RLS would otherwise hide other tenants' rows
// from this check entirely.
export async function isSubdomainAvailable(subdomain: string, excludingAccountId?: string): Promise<boolean> {
  const [row] = await db.select({ accountId: hostedWebsites.accountId }).from(hostedWebsites).where(eq(hostedWebsites.subdomain, subdomain));
  return !row || row.accountId === excludingAccountId;
}

async function allocateUniqueSubdomain(base: string): Promise<string> {
  if (await isSubdomainAvailable(base)) return base;
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = `${base}-${Math.random().toString(36).slice(2, 8)}`;
    if (await isSubdomainAvailable(candidate)) return candidate;
  }
  throw new Error("Failed to allocate a unique site slug");
}

async function getAccountName(accountId: string): Promise<string> {
  const [account] = await db.select({ name: accounts.name }).from(accounts).where(eq(accounts.id, accountId));
  return account?.name ?? "My Property";
}

// Deliberately does not call getOrCreateSite — that auto-creates a hosted_websites row
// on first call, which would be a surprising side effect for a read-only dashboard check.
export async function isWebsitePublished(accountId: string): Promise<boolean> {
  const [website] = await withTenant(accountId, (tx) =>
    tx.select({ isPublished: hostedWebsites.isPublished }).from(hostedWebsites).where(eq(hostedWebsites.accountId, accountId)),
  );
  return website?.isPublished ?? false;
}

export async function getOrCreateSite(accountId: string): Promise<SiteConfig> {
  const existing = await withTenant(accountId, async (tx) => {
    const [website] = await tx.select().from(hostedWebsites).where(eq(hostedWebsites.accountId, accountId));
    if (!website) return null;
    const [page] = await tx.select().from(websitePages).where(and(eq(websitePages.websiteId, website.id), eq(websitePages.slug, HOME_PAGE_SLUG)));
    return { website, page };
  });

  if (existing) {
    const content = existing.page ? extractContent(existing.page.layoutSchema as LayoutSchema) : { heroTitle: "", heroSubtitle: "", featuredUnitIds: [] };
    return toSiteConfig(existing.website, content);
  }

  const accountName = await getAccountName(accountId);
  const subdomain = await allocateUniqueSubdomain(slugify(accountName));
  const defaultLayout: LayoutSchema = [
    { type: "hero", title: accountName, subtitle: "" },
    { type: "room_cards", unitIds: [] },
  ];

  return withTenant(accountId, async (tx) => {
    const [website] = await tx.insert(hostedWebsites).values({ accountId, subdomain, themeConfig: DEFAULT_THEME }).returning();
    if (!website) throw new Error("Failed to create site");

    const [page] = await tx
      .insert(websitePages)
      .values({ accountId, websiteId: website.id, slug: HOME_PAGE_SLUG, layoutSchema: defaultLayout, isPublished: false })
      .returning();
    if (!page) throw new Error("Failed to create site's home page");

    return toSiteConfig(website, extractContent(page.layoutSchema as LayoutSchema));
  });
}

export async function updateSite(accountId: string, input: UpdateSiteRequest): Promise<SiteConfig> {
  await getOrCreateSite(accountId);

  return withTenant(accountId, async (tx) => {
    const [website] = await tx.select().from(hostedWebsites).where(eq(hostedWebsites.accountId, accountId));
    if (!website) throw new Error("Site unexpectedly missing after getOrCreateSite");

    const nextTheme: ThemeConfig = {
      ...(website.themeConfig as ThemeConfig),
      ...(input.primaryColor !== undefined && { primaryColor: input.primaryColor }),
    };

    const [updatedWebsite] = await tx
      .update(hostedWebsites)
      .set({
        subdomain: input.slug ?? website.subdomain,
        customDomain: input.customDomain === undefined ? website.customDomain : input.customDomain,
        themeConfig: nextTheme,
        isPublished: input.isPublished ?? website.isPublished,
        updatedAt: new Date(),
      })
      .where(eq(hostedWebsites.id, website.id))
      .returning();
    if (!updatedWebsite) throw new Error("Failed to update site");

    const [page] = await tx.select().from(websitePages).where(and(eq(websitePages.websiteId, website.id), eq(websitePages.slug, HOME_PAGE_SLUG)));
    if (!page) throw new Error("Site's home page unexpectedly missing after getOrCreateSite");

    const existingContent = extractContent(page.layoutSchema as LayoutSchema);
    const nextLayout: LayoutSchema = [
      { type: "hero", title: input.heroTitle ?? existingContent.heroTitle, subtitle: input.heroSubtitle ?? existingContent.heroSubtitle },
      { type: "room_cards", unitIds: input.featuredUnitIds ?? existingContent.featuredUnitIds },
    ];

    const [updatedPage] = await tx
      .update(websitePages)
      .set({ layoutSchema: nextLayout, isPublished: updatedWebsite.isPublished, updatedAt: new Date() })
      .where(eq(websitePages.id, page.id))
      .returning();
    if (!updatedPage) throw new Error("Failed to update site's home page");

    return toSiteConfig(updatedWebsite, extractContent(updatedPage.layoutSchema as LayoutSchema));
  });
}
