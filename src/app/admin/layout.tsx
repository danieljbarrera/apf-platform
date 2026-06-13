'use client';
import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { getSupabaseBrowser } from '@/lib/supabase-browser';

const STATUS_COLORS: Record<string, string> = {
  New: '#2d5a9e',
  Booked: '#97784c',
  'Menu Development': '#b45309',
  EO: '#6d28d9',
  Completed: '#38614a',
  Lost: '#79715f',
};

export { STATUS_COLORS };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const supabase = getSupabaseBrowser();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session && pathname !== '/admin/login') {
        router.replace('/admin/login');
      } else {
        setChecking(false);
      }
    });
  }, [pathname, router]);

  async function handleLogout() {
    const supabase = getSupabaseBrowser();
    await supabase.auth.signOut();
    router.replace('/admin/login');
  }

  if (pathname === '/admin/login') return <>{children}</>;
  if (checking) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--paper)' }}>
      <div style={{ color: 'var(--ink-3)', fontSize: 14 }}>Loading...</div>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: 'var(--paper)' }}>
      {/* Top nav */}
      <nav style={{ background: 'var(--ink)', borderBottom: '1px solid rgba(255,255,255,0.08)', padding: '0 1.5rem', display: 'flex', alignItems: 'center', gap: 24, height: 52 }}>
        <div style={{ fontFamily: 'var(--serif)', color: '#fff', fontSize: '1.05rem', fontWeight: 500, marginRight: 8 }}>
          All Purpose Flower
        </div>
        <div style={{ height: 20, width: 1, background: 'rgba(255,255,255,0.15)' }} />
        <NavLink href="/admin" active={pathname === '/admin'}>Dashboard</NavLink>
        <div style={{ flex: 1 }} />
        <button
          onClick={handleLogout}
          style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.7)', borderRadius: 'var(--r-sm)', padding: '5px 14px', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--sans)', letterSpacing: '0.06em', textTransform: 'uppercase' }}
        >
          Sign out
        </button>
      </nav>
      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '2rem 1.5rem 4rem' }}>
        {children}
      </main>
    </div>
  );
}

function NavLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <a href={href} style={{ color: active ? '#fff' : 'rgba(255,255,255,0.55)', fontSize: 13, textDecoration: 'none', fontWeight: active ? 500 : 400, letterSpacing: '0.04em' }}>
      {children}
    </a>
  );
}
