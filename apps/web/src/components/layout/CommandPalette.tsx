import { NOTE_TYPES } from '@tresor/shared';
import { Command } from 'cmdk';
import {
  HousePlug,
  Languages,
  LayoutDashboard,
  LifeBuoy,
  Lock,
  Moon,
  ScanQrCode,
  Search,
  Settings2,
  ShieldCheck,
  StickyNote,
  Trash2,
  Users,
} from 'lucide-react';
import { Dialog as D } from 'radix-ui';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { TypeIcon } from '@/components/notes/bits';
import { useNotes } from '@/hooks/notes';
import { TYPE_ICONS } from '@/lib/note-types';
import { searchableText } from '@/lib/secrets';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isAdmin: boolean;
  onToggleTheme: () => void;
  onSwitchLanguage: () => void;
  onLock: () => void;
  onScan: () => void;
}

const itemClass =
  'flex h-11 cursor-pointer items-center gap-3 rounded-[10px] px-3 text-sm text-fg-2 data-[selected=true]:bg-surface-3 data-[selected=true]:text-fg [&_svg]:size-4 [&_svg]:shrink-0';
const groupClass =
  '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted [&_[cmdk-group-heading]]:uppercase';

export function CommandPalette({
  open,
  onOpenChange,
  isAdmin,
  onToggleTheme,
  onSwitchLanguage,
  onLock,
  onScan,
}: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const notes = useNotes('active');

  const run = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };

  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 animate-fade-in bg-[var(--overlay)] backdrop-blur-[2px]" />
        <D.Content
          aria-describedby={undefined}
          className="fixed top-[12vh] left-1/2 z-50 w-[calc(100vw-32px)] max-w-xl -translate-x-1/2 animate-pop-in overflow-hidden rounded-2xl border border-line-strong bg-surface-1 shadow-pop"
        >
          <D.Title className="sr-only">{t('palette.placeholder')}</D.Title>
          <Command
            label={t('palette.placeholder')}
            loop
            // Substring match on every word – more predictable than fuzzy matching for secrets & codes.
            filter={(value, search, keywords) => {
              const haystack = `${value} ${(keywords ?? []).join(' ')}`.toLowerCase();
              return search
                .toLowerCase()
                .split(/\s+/)
                .filter(Boolean)
                .every((term) => haystack.includes(term))
                ? 1
                : 0;
            }}
          >
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Search className="size-4 text-muted" aria-hidden />
              <Command.Input
                placeholder={t('palette.placeholder')}
                className="h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted"
              />
            </div>
            <Command.List className="max-h-[min(60vh,440px)] overflow-y-auto p-2">
              <Command.Empty className="px-3 py-8 text-center text-sm text-muted">
                {t('palette.empty')}
              </Command.Empty>

              {notes.data?.length ? (
                <Command.Group heading={t('palette.entries')} className={groupClass}>
                  {notes.data.slice(0, 200).map((n) => (
                    <Command.Item
                      key={n.id}
                      value={`${n.id} ${searchableText(n)}`}
                      onSelect={() => run(() => navigate(`/notes?id=${n.id}`))}
                      className={itemClass}
                    >
                      <TypeIcon type={n.type} size="sm" />
                      <span className="truncate text-fg">{n.title || t('notes.untitled')}</span>
                      <span className="ml-auto shrink-0 text-xs text-muted">{t(`types.${n.type}`)}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              ) : null}

              <Command.Group heading={t('palette.create')} className={groupClass}>
                {NOTE_TYPES.map((type) => {
                  const Icon = TYPE_ICONS[type];
                  return (
                    <Command.Item
                      key={type}
                      value={`new ${type} ${t(`types.${type}`)}`}
                      onSelect={() => run(() => navigate(`/notes?new=${type}`))}
                      className={itemClass}
                    >
                      <Icon style={{ color: `var(--t-${type})` }} />
                      {t('palette.newOf', { type: t(`types.${type}`) })}
                    </Command.Item>
                  );
                })}
              </Command.Group>

              <Command.Group heading={t('palette.navigation')} className={groupClass}>
                <Command.Item onSelect={() => run(() => navigate('/'))} className={itemClass}>
                  <LayoutDashboard /> {t('nav.dashboard')}
                </Command.Item>
                <Command.Item onSelect={() => run(() => navigate('/notes'))} className={itemClass}>
                  <StickyNote /> {t('nav.notes')}
                </Command.Item>
                <Command.Item onSelect={() => run(() => navigate('/devices'))} className={itemClass}>
                  <HousePlug /> {t('nav.devices')}
                </Command.Item>
                <Command.Item onSelect={() => run(() => navigate('/sharing'))} className={itemClass}>
                  <Users /> {t('nav.sharing')}
                </Command.Item>
                <Command.Item onSelect={() => run(() => navigate('/emergency'))} className={itemClass}>
                  <LifeBuoy /> {t('nav.emergency')}
                </Command.Item>
                <Command.Item onSelect={() => run(() => navigate('/trash'))} className={itemClass}>
                  <Trash2 /> {t('nav.trash')}
                </Command.Item>
                <Command.Item onSelect={() => run(() => navigate('/settings'))} className={itemClass}>
                  <Settings2 /> {t('nav.settings')}
                </Command.Item>
                {isAdmin ? (
                  <Command.Item onSelect={() => run(() => navigate('/admin'))} className={itemClass}>
                    <ShieldCheck /> {t('nav.admin')}
                  </Command.Item>
                ) : null}
              </Command.Group>

              <Command.Group heading={t('palette.actions')} className={groupClass}>
                <Command.Item onSelect={() => run(onScan)} className={itemClass}>
                  <ScanQrCode /> {t('scan.newFromQr')}
                </Command.Item>
                <Command.Item onSelect={() => run(onToggleTheme)} className={itemClass}>
                  <Moon /> {t('palette.toggleTheme')}
                </Command.Item>
                <Command.Item onSelect={() => run(onSwitchLanguage)} className={itemClass}>
                  <Languages /> {t('palette.switchLanguage')}
                </Command.Item>
                <Command.Item onSelect={() => run(onLock)} className={itemClass}>
                  <Lock /> {t('palette.lock')}
                </Command.Item>
              </Command.Group>
            </Command.List>
          </Command>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
