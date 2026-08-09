'use client';

import Link from 'next/link';

/**
 * The researcher tool has two rooms — assembling the sets before a study, and
 * running the sessions during one — and they need to be reachable from each
 * other. Shipping a screen with no way in is the same as not shipping it.
 */
const TABS = [
  { href: '/study/admin/curation', label: 'Set curation' },
  { href: '/study/admin/console', label: 'Session console' },
] as const;

export default function AdminNav({ current }: { current: 'curation' | 'console' }) {
  return (
    <nav className="flex items-center gap-0.5 rounded-lg bg-[hsl(var(--muted))] p-0.5">
      {TABS.map((tab) => {
        const active = tab.href.endsWith(current);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`rounded-md px-2.5 py-1 text-[11.5px] font-semibold transition-colors ${
              active
                ? 'bg-[hsl(var(--card))] text-[hsl(var(--foreground))] shadow-sm'
                : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
