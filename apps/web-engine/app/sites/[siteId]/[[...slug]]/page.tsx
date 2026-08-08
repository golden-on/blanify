import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { LayoutSchema, ThemeConfig } from "@repo/shared-types";
import { DynamicLayoutRenderer } from "@/components/DynamicLayoutRenderer";

interface ResolvedSiteData {
  website: { id: string; themeConfig: ThemeConfig };
  page: { layoutSchema: LayoutSchema };
}

export default async function SitePage() {
  const headerList = await headers();
  const raw = headerList.get("x-site-data");
  if (!raw) {
    notFound();
  }

  const { website, page } = JSON.parse(raw) as ResolvedSiteData;

  return <DynamicLayoutRenderer layoutSchema={page.layoutSchema} theme={website.themeConfig} />;
}
