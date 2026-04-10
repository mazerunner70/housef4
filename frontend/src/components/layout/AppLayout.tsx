import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  Bell,
  Home,
  LineChart,
  LogOut,
  Search,
  Settings,
  Wallet,
} from 'lucide-react'

import { useAuth } from '@/auth/useAuth'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'

/** Top bar labels match the reference; only Dashboard is wired in Stage 1. */
const topNav: { label: string; to?: string; placeholder?: boolean }[] = [
  { label: 'Dashboard', to: '/dashboard' },
  { label: 'Accounts', placeholder: true },
  { label: 'Investments', placeholder: true },
  { label: 'Budgets', placeholder: true },
  { label: 'Reports', placeholder: true },
]

const sidebarNav = [
  { to: '/dashboard', label: 'Dashboard', icon: Home },
  { to: '/import', label: 'Import', icon: Wallet },
  { to: '/review-queue', label: 'Review queue', icon: LineChart },
] as const

function AuraLogo() {
  return (
    <div className="flex w-full flex-col items-center gap-2">
      <div
        className="relative flex size-12 items-center justify-center"
        aria-hidden
      >
        <span className="absolute inset-0 rotate-[-8deg] rounded-xl bg-gradient-to-br from-fuchsia-500 via-violet-500 to-cyan-400 opacity-90 blur-[1px]" />
        <span className="absolute inset-0.5 rotate-[6deg] rounded-[10px] bg-gradient-to-tr from-emerald-400/90 to-sky-500/90" />
        <span className="relative text-lg font-black tracking-tighter text-white drop-shadow-md">
          A
        </span>
      </div>
      <span className="max-w-[4.5rem] text-center text-[9px] font-semibold uppercase leading-tight tracking-[0.2em] text-zinc-500">
        House Finance
      </span>
    </div>
  )
}

function initialsFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email
  const parts = local.split(/[.\s_-]+/).filter(Boolean)
  if (parts.length >= 2) {
    const a = parts[0]?.charAt(0) ?? ''
    const b = parts[1]?.charAt(0) ?? ''
    if (a && b) return `${a}${b}`.toUpperCase()
  }
  return local.slice(0, 2).toUpperCase()
}

export function AppLayout() {
  const location = useLocation()
  const { cognitoEnabled, userEmail, logout } = useAuth()

  return (
    <div className="dashboard-ambient flex min-h-svh text-zinc-300">
      <aside
        className="flex w-[76px] shrink-0 flex-col items-center border-r border-[var(--color-border)] bg-[var(--color-sidebar)]/90 py-6 backdrop-blur-sm"
        aria-label="Primary"
      >
        <div className="mb-8 px-1">
          <AuraLogo />
        </div>
        <nav className="flex flex-1 flex-col items-stretch gap-1 px-1">
          {sidebarNav.map(({ to, label, icon: Icon }) => {
            const active =
              to === '/dashboard'
                ? location.pathname === '/dashboard'
                : location.pathname.startsWith(to)
            return (
              <NavLink
                key={to}
                to={to}
                title={label}
                className={cn(
                  'relative flex w-full justify-center rounded-xl py-2 transition',
                )}
                aria-current={active ? 'page' : undefined}
              >
                {active && (
                  <span
                    className="ui-nav-glow-indicator absolute left-0 top-1/2 z-0 h-8 w-1 -translate-y-1/2 rounded-r-full bg-[var(--color-nav-accent)]"
                    aria-hidden
                  />
                )}
                <span
                  className={cn(
                    'relative z-10 flex size-11 items-center justify-center rounded-xl transition',
                    active
                      ? 'bg-teal-500/20 text-teal-300 ui-nav-glow-icon'
                      : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-300',
                  )}
                >
                  <Icon className="size-5" aria-hidden />
                </span>
                <span className="sr-only">{label}</span>
              </NavLink>
            )
          })}
        </nav>
        <button
          type="button"
          className="mt-auto flex size-11 items-center justify-center rounded-xl text-zinc-600 hover:bg-white/5 hover:text-zinc-400"
          aria-label="Settings"
        >
          <Settings className="size-5" />
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-[var(--color-border)] bg-[var(--color-header-bg)]/90 backdrop-blur-xl">
          <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 lg:px-8">
            <nav
              className="flex flex-wrap items-center gap-1 lg:gap-8"
              aria-label="Sections"
            >
              {topNav.map(({ to, label, placeholder }) => {
                const active =
                  !placeholder &&
                  to != null &&
                  (to === '/dashboard'
                    ? location.pathname === '/dashboard'
                    : location.pathname.startsWith(to))
                if (placeholder || !to) {
                  return (
                    <span
                      key={label}
                      className="cursor-default px-0.5 py-2 text-sm font-medium text-zinc-600"
                      aria-disabled="true"
                    >
                      {label}
                    </span>
                  )
                }
                return (
                  <NavLink
                    key={label}
                    to={to}
                    className={cn(
                      'relative px-0.5 py-2 text-sm font-medium transition',
                      active ? 'text-white' : 'text-zinc-500 hover:text-zinc-300',
                    )}
                    aria-current={active ? 'page' : undefined}
                  >
                    {label}
                    {active && (
                      <span
                        className="ui-nav-glow-underline absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-[var(--color-nav-accent)]"
                        aria-hidden
                      />
                    )}
                  </NavLink>
                )
              })}
            </nav>

            <div className="flex flex-wrap items-center gap-3">
              <label className="relative hidden min-w-[200px] sm:block">
                <span className="sr-only">Search</span>
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-600"
                  aria-hidden
                />
                <input
                  type="search"
                  placeholder="Search"
                  className="ui-surface-input w-full rounded-full py-2 pl-9 pr-3 text-sm text-zinc-200 placeholder:text-zinc-600 outline-none ring-teal-500/25 focus:ring-2"
                />
              </label>
              <button
                type="button"
                className="ui-surface-input relative flex size-10 items-center justify-center rounded-full text-zinc-400 hover:text-white"
                aria-label="Notifications"
              >
                <Bell className="size-[18px]" />
                <span className="ui-notify-dot absolute right-2 top-2 size-2 rounded-full bg-red-500" />
              </button>
              <div className="flex flex-wrap items-center gap-2">
                {cognitoEnabled && userEmail ? (
                  <>
                    <div className="ui-surface-input flex items-center gap-2 rounded-full py-1 pl-1 pr-3">
                      <div
                        className="flex size-8 items-center justify-center rounded-full bg-teal-500/15 text-xs font-semibold uppercase tracking-wide text-teal-200"
                        aria-hidden
                      >
                        {initialsFromEmail(userEmail)}
                      </div>
                      <span className="hidden max-w-[10rem] truncate text-sm font-medium text-zinc-200 sm:inline">
                        {userEmail}
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      className="shrink-0 gap-1.5 px-2 py-2 text-xs text-zinc-400"
                      onClick={() => logout()}
                    >
                      <LogOut className="size-4" aria-hidden />
                      <span className="hidden sm:inline">Sign out</span>
                    </Button>
                  </>
                ) : (
                  <div className="ui-surface-input flex items-center gap-2 rounded-full py-1 pl-1 pr-3">
                    <div
                      className="flex size-8 items-center justify-center rounded-full bg-teal-500/15 text-xs font-semibold uppercase tracking-wide text-teal-200"
                      aria-label="Alex R. avatar"
                    >
                      AR
                    </div>
                    <span className="hidden text-sm font-medium text-zinc-200 sm:inline">
                      Alex R.
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 px-5 py-8 lg:px-8">
          <div className="mx-auto max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
