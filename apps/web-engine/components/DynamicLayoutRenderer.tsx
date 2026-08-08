import type { CSSProperties } from "react";
import type { LayoutSchema, Section, ThemeConfig } from "@repo/shared-types";

interface DynamicLayoutRendererProps {
  layoutSchema: LayoutSchema;
  theme: ThemeConfig;
}

export function DynamicLayoutRenderer({ layoutSchema, theme }: DynamicLayoutRendererProps) {
  const style = { "--brand": theme.primaryColor, fontFamily: theme.fontFamily } as CSSProperties;

  return (
    <div style={style} className="min-h-screen bg-white">
      {layoutSchema.map((section, index) => (
        <SectionBlock key={index} section={section} />
      ))}
    </div>
  );
}

function SectionBlock({ section }: { section: Section }) {
  switch (section.type) {
    case "hero":
      return (
        <section className="flex flex-col items-center justify-center gap-4 bg-[var(--brand)] px-6 py-24 text-center text-white">
          <h1 className="text-4xl font-bold">{section.title}</h1>
          {section.subtitle ? <p className="max-w-xl text-lg">{section.subtitle}</p> : null}
        </section>
      );
    case "gallery":
      return (
        <section className="grid grid-cols-2 gap-2 p-6 md:grid-cols-3">
          {section.images.map((src) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={src} src={src} alt="" className="aspect-square w-full rounded-lg object-cover" />
          ))}
        </section>
      );
    case "room_cards":
      return (
        <section className="grid grid-cols-1 gap-4 p-6 md:grid-cols-3">
          {section.unitIds.map((unitId) => (
            <div key={unitId} className="rounded-lg border p-4 shadow-sm">
              <p className="font-medium">Unit {unitId}</p>
            </div>
          ))}
        </section>
      );
    case "amenities":
      return (
        <section className="p-6">
          <ul className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {section.items.map((item) => (
              <li key={item} className="rounded bg-gray-100 px-3 py-2 text-sm">
                {item}
              </li>
            ))}
          </ul>
        </section>
      );
    case "faq":
      return (
        <section className="mx-auto max-w-2xl p-6">
          {section.items.map((item) => (
            <details key={item.question} className="border-b py-3">
              <summary className="cursor-pointer font-medium">{item.question}</summary>
              <p className="mt-2 text-gray-600">{item.answer}</p>
            </details>
          ))}
        </section>
      );
    default:
      return null;
  }
}
