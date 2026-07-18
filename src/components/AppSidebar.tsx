'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV: { href: string; icon: string; label: string }[] = [
  { href: '/', icon: '📈', label: 'Phân tích kèo' },
  { href: '/report', icon: '📊', label: 'Thống kê kèo' },
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(href + '/');
}

export default function AppSidebar() {
  const pathname = usePathname() ?? '/';

  return (
    <>
      {/* Desktop: slim fixed left rail */}
      <nav
        aria-label="Điều hướng chính"
        className="hidden md:flex fixed left-0 top-0 bottom-0 z-40 w-12 flex-col items-center gap-1 border-r border-[#1a1a1a] bg-[#0a0a0a] py-3"
      >
        {NAV.map(({ href, icon, label }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              title={label}
              aria-current={active ? 'page' : undefined}
              className={`group relative flex h-10 w-10 flex-col items-center justify-center rounded-lg text-[18px] transition-colors ${
                active ? 'bg-white/[.12] text-white' : 'text-white/45 hover:bg-white/[.06] hover:text-white'
              }`}
            >
              <span>{icon}</span>
              {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r bg-[#17a2b8]" />}
              <span className="pointer-events-none absolute left-[52px] z-50 hidden whitespace-nowrap rounded bg-[#1a1a1a] px-2 py-1 text-[11px] text-white shadow-lg group-hover:block">
                {label}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Mobile: thin top strip (avoids colliding with page-level bottom nav) */}
      <nav
        aria-label="Điều hướng chính"
        className="md:hidden fixed inset-x-0 top-0 z-40 flex h-9 items-stretch border-b border-[#1a1a1a] bg-[#0a0a0a]"
      >
        {NAV.map(({ href, icon, label }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={`flex flex-1 items-center justify-center gap-1 text-[12px] ${
                active ? 'text-white border-b-2 border-[#17a2b8]' : 'text-white/45'
              }`}
            >
              <span className="text-[14px]">{icon}</span>
              <span className="truncate">{label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
