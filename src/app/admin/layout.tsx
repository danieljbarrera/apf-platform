'use client';
import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import { ToastProvider } from '@/lib/toast';

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
  const [menuOpen, setMenuOpen] = useState(false);

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

  // Close menu on route change
  useEffect(() => { setMenuOpen(false); }, [pathname]);

  async function handleLogout() {
    const supabase = getSupabaseBrowser();
    await supabase.auth.signOut();
    router.replace('/admin/login');
  }

  if (pathname === '/admin/login') return <ToastProvider>{children}</ToastProvider>;
  if (checking) return (
    <ToastProvider>
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--paper)' }}>
        <div style={{ color: 'var(--ink-3)', fontSize: 14 }}>Loading…</div>
      </div>
    </ToastProvider>
  );

  const navLinks = [
    { href: '/admin', label: 'Dashboard', active: pathname === '/admin' },
    { href: '/admin/analytics', label: 'Analytics', active: pathname === '/admin/analytics' },
  ];

  return (
    <ToastProvider>
      <style>{`
        @media (max-width: 640px) {
          .nav-links-desktop { display: none !important; }
          .nav-hamburger { display: flex !important; }
          .nav-signout-desktop { display: none !important; }
        }
        @media (min-width: 641px) {
          .nav-hamburger { display: none !important; }
          .nav-mobile-menu { display: none !important; }
        }
      `}</style>
      <div style={{ minHeight: '100vh', background: 'var(--paper)' }}>
        <nav style={{ background: 'var(--ink)', borderBottom: '1px solid rgba(255,255,255,0.08)', padding: '0 1.5rem', display: 'flex', alignItems: 'center', gap: 24, height: 52, position: 'sticky', top: 0, zIndex: 50 }}>
          <div style={{ fontFamily: 'var(--serif)', color: '#fff', fontSize: '1.05rem', fontWeight: 500, marginRight: 8, whiteSpace: 'nowrap' }}>
            All Purpose Flower
          </div>
          <div style={{ height: 20, width: 1, background: 'rgba(255,255,255,0.15)', flexShrink: 0 }} />

          {/* Desktop nav links */}
          <div className="nav-links-desktop" style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
            {navLinks.map(l => (
              <NavLink key={l.href} href={l.href} active={l.active}>{l.label}</NavLink>
            ))}
          </div>

          <div style={{ flex: 1 }} />

          <SquareModeBadge />

          {/* Desktop sign out */}
          <button className="nav-signout-desktop"
            onClick={handleLogout}
            style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.7)', borderRadius: 'var(--r-sm)', padding: '5px 14px', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--sans)', letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}
          >
            Sign out
          </button>

          {/* Mobile hamburger */}
          <button className="nav-hamburger"
            onClick={() => setMenuOpen(o => !o)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '6px', color: 'rgba(255,255,255,0.8)', display: 'none', flexDirection: 'column', gap: 5, alignItems: 'center', justifyContent: 'center', width: 36, height: 36 }}
            aria-label="Menu"
          >
            <span style={{ display: 'block', width: 20, height: 2, background: menuOpen ? 'transparent' : 'currentColor', transition: 'all 0.2s', transform: menuOpen ? 'rotate(45deg) translate(5px, 5px)' : 'none' }} />
            <span style={{ display: 'block', width: 20, height: 2, background: 'currentColor', transition: 'all 0.2s', transform: menuOpen ? 'rotate(45deg)' : 'none', marginTop: menuOpen ? -9 : 0 }} />
            <span style={{ display: 'block', width: 20, height: 2, background: menuOpen ? 'transparent' : 'currentColor', transition: 'all 0.2s' }} />
          </button>
        </nav>

        {/* Mobile dropdown menu */}
        {menuOpen && (
          <div className="nav-mobile-menu" style={{ background: 'var(--ink)', borderBottom: '1px solid rgba(255,255,255,0.08)', padding: '0.5rem 1.5rem 1rem', position: 'sticky', top: 52, zIndex: 49 }}>
            {navLinks.map(l => (
              <a key={l.href} href={l.href} onClick={() => setMenuOpen(false)} style={{ display: 'block', color: l.active ? '#fff' : 'rgba(255,255,255,0.6)', fontSize: 15, textDecoration: 'none', fontWeight: l.active ? 500 : 400, padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                {l.label}
              </a>
            ))}
            <button onClick={handleLogout} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.7)', borderRadius: 'var(--r-sm)', padding: '8px 16px', fontSize: 13, cursor: 'pointer', fontFamily: 'var(--sans)', marginTop: 12, width: '100%' }}>
              Sign out
            </button>
          </div>
        )}

        <main style={{ maxWidth: 1200, margin: '0 auto', padding: '2rem 1.5rem 4rem' }}>
          {children}
        </main>
      </div>
    </ToastProvider>
  );
}

function SquareModeBadge() {
  const [mode, setMode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function authFetch(url: string, opts?: RequestInit) {
    const supabase = getSupabaseBrowser();
    const { data: { session } } = await supabase.auth.getSession();
    return fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}`, ...opts?.headers } });
  }

  useEffect(() => {
    authFetch('/api/admin/square/mode').then(r => r.json()).then(d => setMode(d.mode)).catch(() => {});
  }, []);

  async function toggle() {
    const next = mode === 'production' ? 'sandbox' : 'production';
    if (next === 'production' && !confirm('Switch to PRODUCTION (live) Square?\n\nNew invoices you create and send will be REAL and charge real clients.')) return;
    setBusy(true);
    const res = await authFetch('/api/admin/square/mode', { method: 'POST', body: JSON.stringify({ mode: next }) });
    const d = await res.json();
    setBusy(false);
    if (res.ok) setMode(d.mode); else alert(d.error || 'Failed to switch');
  }

  if (!mode) return null;
  const live = mode === 'production';
  return (
    <button onClick={toggle} disabled={busy} title="Click to switch Square environment (new invoices)"
      style={{ background: live ? 'rgba(220,38,38,0.18)' : 'rgba(255,255,255,0.08)', border: `1px solid ${live ? 'rgba(248,113,113,0.55)' : 'rgba(255,255,255,0.2)'}`, color: live ? '#fca5a5' : 'rgba(255,255,255,0.65)', borderRadius: 99, padding: '4px 11px', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', cursor: busy ? 'wait' : 'pointer', fontFamily: 'var(--sans)', whiteSpace: 'nowrap', marginRight: 4 }}>
      {busy ? '…' : (live ? '● LIVE' : '○ SANDBOX')}
    </button>
  );
}

function NavLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <a href={href} style={{ color: active ? '#fff' : 'rgba(255,255,255,0.55)', fontSize: 13, textDecoration: 'none', fontWeight: active ? 500 : 400, letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
      {children}
    </a>
  );
}
