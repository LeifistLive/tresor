import { type MeDto, NOTE_TYPES } from '@tresor/shared';
import {
  BookmarkPlus,
  HousePlug,
  LayoutDashboard,
  LifeBuoy,
  Lock,
  Menu as MenuIcon,
  Moon,
  Plus,
  ScanQrCode,
  Search,
  Settings2,
  ShieldCheck,
  StickyNote,
  Sun,
  Trash2,
  User,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { TypeDot } from '@/components/notes/bits';
import { QrScanner } from '@/components/scan/QrScanner';
import { Button } from '@/components/ui/button';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import { Kbd, Segmented } from '@/components/ui/misc';
import { useApplyUser, useLock } from '@/hooks/auth';
import { useNotes } from '@/hooks/notes';
import { useAutoLock } from '@/hooks/useAutoLock';
import { useHotkey } from '@/hooks/useHotkey';
import { useTemplates, useVaultMaintenance, useVaults } from '@/hooks/vaults';
import { setLanguage } from '@/i18n';
import { api } from '@/lib/api';
import { TYPE_ICONS } from '@/lib/note-types';
import { setPrefill } from '@/lib/prefill';
import { prefillFromQr } from '@/lib/scan';
import { applyTheme, resolvedTheme } from '@/lib/theme';
import { cn, initials } from '@/lib/utils';
import { CommandPalette } from './CommandPalette';
import { Logo } from './Logo';

function NavItem({
  to,
  icon,
  label,
  count,
  end,
  onNavigate,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
  count?: number;
  end?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'flex h-10 items-center gap-3 rounded-[10px] px-3 text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg [&_svg]:size-[18px]',
          isActive && 'bg-surface-3 font-medium text-fg hover:bg-surface-3',
        )
      }
    >
      {icon}
      <span className="truncate">{label}</span>
      {count !== undefined ? (
        <span className="ml-auto font-mono text-xs text-muted tabular-nums">{count}</span>
      ) : null}
    </NavLink>
  );
}

function SectionLabel({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-3 pb-1.5 text-[11px] font-medium tracking-[0.08em] text-muted uppercase">
      {children}
      {action}
    </div>
  );
}

function Sidebar({ me, onNavigate }: { me: MeDto; onNavigate?: () => void }) {
  const { t } = useTranslation();
  const notes = useNotes('active');
  const trash = useNotes('trash');
  const vaults = useVaults();
  useVaultMaintenance();
  const lock = useLock();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const onNotes = location.pathname === '/notes';

  const counts = useMemo(() => {
    const byType = Object.fromEntries(NOTE_TYPES.map((x) => [x, 0])) as Record<string, number>;
    const byVault = new Map<string, number>();
    const tags = new Map<string, number>();
    for (const n of notes.data ?? []) {
      byType[n.type] = (byType[n.type] ?? 0) + 1;
      byVault.set(n.vaultId ?? 'personal', (byVault.get(n.vaultId ?? 'personal') ?? 0) + 1);
      for (const tag of n.tags) tags.set(tag, (tags.get(tag) ?? 0) + 1);
    }
    const topTags = [...tags.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8);
    return { byType, byVault, topTags };
  }, [notes.data]);

  const filterLink = (active: boolean) =>
    cn(
      'flex h-9 items-center gap-3 rounded-[10px] px-3 text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg',
      active && 'bg-surface-2 text-fg',
    );

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto px-3.5 py-5">
      <div className="flex items-center justify-between px-2">
        <Link to="/" onClick={onNavigate} className="rounded-lg">
          <Logo />
        </Link>
        <span className="rounded-md border border-line-strong px-1.5 py-0.5 font-mono text-[11px] text-muted">
          v{__APP_VERSION__}
        </span>
      </div>

      <nav aria-label={t('nav.mainNavigation')} className="flex flex-col gap-0.5">
        <NavItem to="/" end icon={<LayoutDashboard />} label={t('nav.dashboard')} onNavigate={onNavigate} />
        <NavItem
          to="/notes"
          icon={<StickyNote />}
          label={t('nav.notes')}
          count={notes.data?.length}
          onNavigate={onNavigate}
        />
        <NavItem
          to="/devices"
          icon={<HousePlug />}
          label={t('nav.devices')}
          count={counts.byType.matter}
          onNavigate={onNavigate}
        />
        <NavItem
          to="/trash"
          icon={<Trash2 />}
          label={t('nav.trash')}
          count={trash.data?.length}
          onNavigate={onNavigate}
        />
      </nav>

      <div className="flex flex-col gap-0.5">
        <SectionLabel
          action={
            <Link
              to="/sharing"
              onClick={onNavigate}
              className="rounded px-1 text-[11px] font-medium tracking-normal normal-case text-accent-text hover:underline"
            >
              {t('nav.manage')}
            </Link>
          }
        >
          {t('nav.vaults')}
        </SectionLabel>
        <Link
          to="/notes?vault=personal"
          onClick={onNavigate}
          className={filterLink(onNotes && params.get('vault') === 'personal')}
        >
          <User className="size-4 text-muted" aria-hidden />
          <span className="truncate">{t('vaults.personal')}</span>
          <span className="ml-auto font-mono text-xs text-muted tabular-nums">
            {counts.byVault.get('personal') ?? 0}
          </span>
        </Link>
        {(vaults.data ?? []).map((v) => (
          <Link
            key={v.id}
            to={`/notes?vault=${v.id}`}
            onClick={onNavigate}
            className={filterLink(onNotes && params.get('vault') === v.id)}
          >
            <Users className="size-4 text-muted" aria-hidden />
            <span className="truncate">{v.name}</span>
            <span className="ml-auto font-mono text-xs text-muted tabular-nums">
              {counts.byVault.get(v.id) ?? 0}
            </span>
          </Link>
        ))}
      </div>

      <div className="flex flex-col gap-0.5">
        <SectionLabel>{t('nav.types')}</SectionLabel>
        {NOTE_TYPES.map((type) => (
          <Link
            key={type}
            to={`/notes?type=${type}`}
            onClick={onNavigate}
            className={filterLink(onNotes && params.get('type') === type)}
          >
            <TypeDot type={type} />
            <span className="truncate">{t(`typesPlural.${type}`)}</span>
            <span className="ml-auto font-mono text-xs text-muted tabular-nums">
              {counts.byType[type] ?? 0}
            </span>
          </Link>
        ))}
      </div>

      {counts.topTags.length ? (
        <div className="flex flex-col gap-0.5">
          <SectionLabel>{t('nav.tags')}</SectionLabel>
          {counts.topTags.map(([tag, n]) => (
            <Link
              key={tag}
              to={`/notes?tag=${encodeURIComponent(tag)}`}
              onClick={onNavigate}
              className={cn(filterLink(onNotes && params.get('tag') === tag), 'gap-2')}
            >
              <span className="text-muted">#</span>
              <span className="truncate">{tag}</span>
              <span className="ml-auto font-mono text-xs text-muted tabular-nums">{n}</span>
            </Link>
          ))}
        </div>
      ) : null}

      <div className="flex flex-col gap-0.5">
        <SectionLabel>{t('nav.management')}</SectionLabel>
        <NavItem to="/emergency" icon={<LifeBuoy />} label={t('nav.emergency')} onNavigate={onNavigate} />
        {me.role === 'admin' ? (
          <NavItem to="/admin" icon={<ShieldCheck />} label={t('nav.admin')} onNavigate={onNavigate} />
        ) : null}
        <NavItem to="/settings" icon={<Settings2 />} label={t('nav.settings')} onNavigate={onNavigate} />
      </div>

      <div className="mt-auto flex items-center gap-2.5 rounded-2xl border border-line bg-surface-2 p-2.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-surface-3 text-[13px] font-semibold">
          {initials(me.displayName)}
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{me.displayName}</span>
          <span className="truncate text-xs text-muted">@{me.username}</span>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto"
          aria-label={t('nav.lock')}
          title={t('nav.lock')}
          onClick={() => void lock('logout')}
        >
          <Lock />
        </Button>
      </div>
    </div>
  );
}

export function AppShell({ me }: { me: MeDto }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const lock = useLock();
  const applyUser = useApplyUser();
  const templates = useTemplates();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [, force] = useState(0);

  useAutoLock(me.autoLockMinutes, () => void lock('locked'));
  useHotkey('k', () => setPaletteOpen((o) => !o));
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMobileOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  const savePrefs = async (prefs: Parameters<typeof api.updatePreferences>[0]) => {
    try {
      applyUser((await api.updatePreferences(prefs)).user);
    } catch {
      /* the UI already switched locally */
    }
  };
  const switchLanguage = (lang: 'de' | 'en') => {
    setLanguage(lang);
    void savePrefs({ language: lang });
  };
  const toggleTheme = () => {
    const next = resolvedTheme() === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    force((x) => x + 1);
    void savePrefs({ theme: next });
  };

  /** Creates a new entry from a template or a scanned QR code. */
  const startWith = (prefill: Parameters<typeof setPrefill>[0]) => {
    setPrefill(prefill);
    navigate(`/notes?new=${prefill.type}`);
  };

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[272px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh border-r border-line bg-surface-1 lg:block">
        <Sidebar me={me} />
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label={t('common.close')}
            className="absolute inset-0 animate-fade-in bg-[var(--overlay)]"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-[86vw] max-w-80 animate-drawer-in border-r border-line bg-surface-1 shadow-pop">
            <Sidebar me={me} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-line bg-[color-mix(in_oklab,var(--bg)_82%,transparent)] px-4 backdrop-blur-xl sm:gap-3 sm:px-6 lg:px-8">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label={t('nav.menu')}
            onClick={() => setMobileOpen(true)}
          >
            {mobileOpen ? <X /> : <MenuIcon />}
          </Button>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-[10px] border border-line bg-surface-1 px-3 text-left text-muted transition-colors hover:border-line-strong sm:max-w-[480px]"
          >
            <Search className="size-4 shrink-0" aria-hidden />
            <span className="truncate text-sm">{t('nav.search')}</span>
            <span className="ml-auto hidden sm:block">
              <Kbd>⌘K</Kbd>
            </span>
          </button>
          <div className="ml-auto flex items-center gap-2">
            <Segmented
              className="hidden sm:inline-flex"
              label={t('nav.language')}
              value={i18n.language === 'de' ? 'de' : 'en'}
              onChange={switchLanguage}
              mono
              options={[
                { value: 'de', label: 'DE', ariaLabel: 'Deutsch' },
                { value: 'en', label: 'EN', ariaLabel: 'English' },
              ]}
            />
            <Button
              variant="outline"
              size="icon"
              className="max-sm:hidden"
              aria-label={t('scan.button')}
              title={t('scan.button')}
              onClick={() => setScanOpen(true)}
            >
              <ScanQrCode />
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label={t('nav.theme')}
              title={t('nav.theme')}
              onClick={toggleTheme}
            >
              {resolvedTheme() === 'dark' ? <Moon /> : <Sun />}
            </Button>
            <Menu>
              <MenuTrigger asChild>
                <Button variant="primary" className="max-sm:w-10 max-sm:px-0" aria-label={t('nav.newEntry')}>
                  <Plus className="!size-[18px]" strokeWidth={2.4} />
                  <span className="hidden sm:inline">{t('nav.newEntry')}</span>
                </Button>
              </MenuTrigger>
              <MenuContent className="max-h-[70vh] overflow-y-auto">
                {NOTE_TYPES.map((type) => {
                  const Icon = TYPE_ICONS[type];
                  return (
                    <MenuItem
                      key={type}
                      icon={<Icon style={{ color: `var(--t-${type})` }} />}
                      onSelect={() => navigate(`/notes?new=${type}`)}
                    >
                      {t(`types.${type}`)}
                    </MenuItem>
                  );
                })}
                <MenuSeparator />
                <MenuItem icon={<ScanQrCode />} onSelect={() => setScanOpen(true)}>
                  {t('scan.newFromQr')}
                </MenuItem>
                {templates.data?.length ? (
                  <>
                    <MenuSeparator />
                    <MenuLabel>{t('templates.title')}</MenuLabel>
                    {templates.data.map((tpl) => (
                      <MenuItem
                        key={tpl.id}
                        icon={<BookmarkPlus />}
                        onSelect={() =>
                          startWith({
                            type: tpl.type,
                            title: tpl.title,
                            content: tpl.content,
                            fields: tpl.fields,
                            customFields: tpl.customFields,
                            tags: tpl.tags,
                          })
                        }
                      >
                        {tpl.name}
                      </MenuItem>
                    ))}
                  </>
                ) : null}
              </MenuContent>
            </Menu>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1240px] flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          <Outlet context={me} />
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        isAdmin={me.role === 'admin'}
        onToggleTheme={toggleTheme}
        onSwitchLanguage={() => switchLanguage(i18n.language === 'de' ? 'en' : 'de')}
        onLock={() => void lock('logout')}
        onScan={() => setScanOpen(true)}
      />
      <QrScanner
        open={scanOpen}
        onOpenChange={setScanOpen}
        onResult={(text) => startWith(prefillFromQr(text))}
      />
    </div>
  );
}
