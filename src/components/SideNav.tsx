"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function SideNav({ items, label }: { items: [string, string][]; label: string }) {
  const path = usePathname();
  return (
    <nav aria-label={label}>
      {items.map(([href, text]) => {
        const base = href.split("?")[0]!;
        const active = path === base || (base !== items[0]![0].split("?")[0] && path.startsWith(base));
        return (
          <Link key={href} href={href} aria-current={active ? "page" : undefined} prefetch={false}>
            {text}
          </Link>
        );
      })}
    </nav>
  );
}
