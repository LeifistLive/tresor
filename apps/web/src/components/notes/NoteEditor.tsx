import { useQueryClient } from '@tanstack/react-query';
import {
  type AttachmentDto,
  type CustomField,
  FIELD_DEFS,
  formatMatterCode,
  NOTE_TYPES,
  type NoteDto,
  type NoteType,
  parseMatterQr,
  parseWifiQr,
  wifiQrPayload,
} from '@tresor/shared';
import {
  BookmarkPlus,
  CalendarClock,
  ChevronDown,
  Ellipsis,
  History,
  LockKeyhole,
  Pin,
  Printer,
  ScanQrCode,
  Trash2,
  User,
  Users,
  X,
} from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { QrScanner } from '@/components/scan/QrScanner';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { Dialog, Sheet } from '@/components/ui/dialog';
import { Field, Input, inputClass } from '@/components/ui/input';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import { Badge, Segmented, Spinner } from '@/components/ui/misc';
import { useCreateNote, useRestoreNote, useTrashNote, useUpdateNote } from '@/hooks/notes';
import { useHotkey } from '@/hooks/useHotkey';
import { useVaults } from '@/hooks/vaults';
import { api } from '@/lib/api';
import { TYPE_ICONS } from '@/lib/note-types';
import { takePrefill } from '@/lib/prefill';
import { matterFieldsFromQr } from '@/lib/scan';
import { parseTotp } from '@/lib/totp';
import { cn, errorMessage, relativeTime } from '@/lib/utils';
import { Attachments } from './Attachments';
import { QrCode, TypeBadge } from './bits';
import { CustomFields } from './CustomFields';
import { FieldInput } from './FieldInput';
import { MatterPanel } from './MatterPanel';
import { TagInput } from './TagInput';
import { VersionsDialog } from './VersionsDialog';

const MarkdownView = lazy(() => import('./Markdown'));

interface Draft {
  type: NoteType;
  title: string;
  content: string;
  fields: Record<string, string>;
  customFields: CustomField[];
  tags: string[];
  pinned: boolean;
  vaultId: string | null;
  expiresAt: string | null;
}

const emptyDraft = (type: NoteType, vaultId: string | null = null): Draft => ({
  type,
  title: '',
  content: '',
  fields: {},
  customFields: [],
  tags: [],
  pinned: false,
  vaultId,
  expiresAt: null,
});

const fromNote = (n: NoteDto): Draft => ({
  type: n.type,
  title: n.title,
  content: n.content,
  fields: { ...n.fields },
  customFields: n.customFields.map((f) => ({ ...f })),
  tags: [...n.tags],
  pinned: n.pinned,
  vaultId: n.vaultId,
  expiresAt: n.expiresAt,
});

/** Only keep fields that belong to the type and are not empty – mirrors the server-side sanitizing. */
function cleanFields(type: NoteType, fields: Record<string, string>) {
  const out: Record<string, string> = {};
  for (const d of FIELD_DEFS[type]) if (fields[d.key]) out[d.key] = fields[d.key]!;
  return out;
}

const cleanCustom = (list: CustomField[]) => list.filter((f) => f.label.trim() || f.value);

const fingerprint = (d: Draft) =>
  JSON.stringify({ ...d, fields: cleanFields(d.type, d.fields), customFields: cleanCustom(d.customFields) });

/** "MM/YY" or "MM/YYYY" → last day of that month as YYYY-MM-DD. */
function expiryFromCard(value: string): string | null {
  const m = /^\s*(\d{1,2})\s*\/\s*(\d{2}|\d{4})\s*$/.exec(value);
  if (!m) return null;
  const month = Number(m[1]);
  const year = m[2]!.length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
  if (month < 1 || month > 12) return null;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}

interface Props {
  /** Existing note being edited, or null. */
  note: NoteDto | null;
  /** Set when creating a new entry. */
  newType: NoteType | null;
  /** Vault preselected for new entries. */
  newVaultId?: string | null;
  loading?: boolean;
  allTags: string[];
  onClose: () => void;
  onCreated?: (note: NoteDto) => void;
  /** Read-only view of someone else's vault (emergency access). */
  emergency?: {
    grantId: string;
    loadAttachment: (noteId: string, file: AttachmentDto) => Promise<Uint8Array>;
  };
}

export function NoteEditor({
  note,
  newType,
  newVaultId,
  loading,
  allTags,
  onClose,
  onCreated,
  emergency,
}: Props) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const create = useCreateNote();
  const update = useUpdateNote();
  const trash = useTrashNote();
  const restore = useRestoreNote();
  const vaults = useVaults();
  const open = Boolean(note || newType || loading);
  const readOnly = Boolean(emergency) || (note ? !note.canEdit : false);

  const [draft, setDraft] = useState<Draft>(() => (note ? fromNote(note) : emptyDraft(newType ?? 'note')));
  const [baseline, setBaseline] = useState(() => fingerprint(draft));
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const [qrOpen, setQrOpen] = useState(false);
  const [scanTarget, setScanTarget] = useState<'matter' | 'wifi' | 'totp' | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const loadedKey = useRef<string | null>(null);

  // (Re)initialize the draft whenever another note is opened.
  useEffect(() => {
    const key = note ? `note:${note.id}` : newType ? `new:${newType}` : null;
    if (!key || key === loadedKey.current) return;
    loadedKey.current = key;
    let next = note ? fromNote(note) : emptyDraft(newType!, newVaultId ?? null);
    if (!note && newType) {
      const prefill = takePrefill(newType);
      if (prefill) {
        next = {
          ...next,
          title: prefill.title ?? '',
          content: prefill.content ?? '',
          fields: { ...prefill.fields },
          customFields: prefill.customFields?.map((f) => ({ ...f })) ?? [],
          tags: prefill.tags ?? [],
        };
      }
    }
    setDraft(next);
    setBaseline(note ? fingerprint(next) : fingerprint(emptyDraft(next.type, next.vaultId)));
    setMode(note?.content ? 'preview' : 'write');
    if (!note) setTimeout(() => titleRef.current?.focus(), 50);
  }, [note, newType, newVaultId]);

  useEffect(() => {
    if (!open) loadedKey.current = null;
  }, [open]);

  // Keep server-side changes (attachments, restored versions) in sync when nothing was edited locally.
  // biome-ignore lint/correctness/useExhaustiveDependencies: react to fresh server data only
  useEffect(() => {
    if (!note || fingerprint(draft) !== baseline) return;
    const next = fromNote(note);
    const fp = fingerprint(next);
    if (fp !== baseline) {
      setDraft(next);
      setBaseline(fp);
    }
  }, [note]);

  const dirty = !readOnly && fingerprint(draft) !== baseline;
  const saving = create.isPending || update.isPending;
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const setFields = (patch: Record<string, string>) =>
    setDraft((d) => ({ ...d, fields: { ...d.fields, ...patch } }));

  const writableVaults = useMemo(() => (vaults.data ?? []).filter((v) => v.role !== 'viewer'), [vaults.data]);
  const currentVault = vaults.data?.find((v) => v.id === draft.vaultId) ?? null;

  const requestClose = async () => {
    if (dirty) {
      const ok = await confirm({
        title: t('editor.unsavedTitle'),
        description: t('editor.unsavedText'),
        confirmLabel: t('editor.discard'),
        cancelLabel: t('editor.keepEditing'),
        danger: true,
      });
      if (!ok) return;
    }
    onClose();
  };

  const save = async () => {
    if (saving || readOnly) return;
    const payload = {
      type: draft.type,
      title: draft.title.trim(),
      content: draft.content,
      fields: cleanFields(draft.type, {
        ...draft.fields,
        ...(draft.type === 'matter' && draft.fields.setupCode
          ? { setupCode: formatMatterCode(draft.fields.setupCode) }
          : {}),
      }),
      customFields: cleanCustom(draft.customFields),
      tags: draft.tags,
      pinned: draft.pinned,
      expiresAt: draft.expiresAt || null,
    };
    try {
      if (note) {
        const saved = await update.mutateAsync({
          id: note.id,
          patch: { ...payload, ...(draft.vaultId !== note.vaultId ? { vaultId: draft.vaultId } : {}) },
        });
        const next = fromNote(saved);
        setDraft(next);
        setBaseline(fingerprint(next));
        toast.success(t('editor.saved'));
      } else {
        const created = await create.mutateAsync({ ...payload, vaultId: draft.vaultId });
        loadedKey.current = `note:${created.id}`;
        const next = fromNote(created);
        setDraft(next);
        setBaseline(fingerprint(next));
        toast.success(t('editor.created'));
        onCreated?.(created);
      }
    } catch (err) {
      toast.error(errorMessage(err, t));
    }
  };

  const remove = async () => {
    if (!note) return;
    try {
      await trash.mutateAsync(note.id);
      onClose();
      toast(t('editor.trashed'), {
        action: { label: t('editor.undo'), onClick: () => restore.mutate(note.id) },
      });
    } catch (err) {
      toast.error(errorMessage(err, t));
    }
  };

  const onScanned = (text: string) => {
    if (scanTarget === 'matter') {
      const fields = matterFieldsFromQr(text);
      if (!fields) return toast.error(t('scan.wrongKind'));
      setFields(fields);
    } else if (scanTarget === 'wifi') {
      const wifi = parseWifiQr(text);
      if (!wifi) return toast.error(t('scan.wrongKind'));
      setFields({ ssid: wifi.ssid, password: wifi.password, security: wifi.security });
      if (!draft.title) set('title', wifi.ssid);
    } else if (scanTarget === 'totp') {
      const info = parseTotp(text);
      if (!info) return toast.error(t('scan.wrongKind'));
      setFields({
        totp: text.trim(),
        ...(draft.fields.username ? {} : info.label ? { username: info.label } : {}),
      });
      if (!draft.title && info.issuer) set('title', info.issuer);
    }
    toast.success(t('scan.success'));
  };

  useHotkey('s', () => void save(), open && !readOnly);

  const defs = FIELD_DEFS[draft.type];
  const matterInfo =
    draft.type === 'matter' && draft.fields.qrPayload ? parseMatterQr(draft.fields.qrPayload) : null;
  const wifiQr =
    draft.type === 'wifi' && draft.fields.ssid
      ? wifiQrPayload(draft.fields.ssid, draft.fields.password ?? '', draft.fields.security ?? 'WPA')
      : null;
  const contentRows = useMemo(
    () => Math.min(18, Math.max(5, draft.content.split('\n').length + 1)),
    [draft.content],
  );
  const cardExpiry =
    draft.type === 'card' && draft.fields.expiry ? expiryFromCard(draft.fields.expiry) : null;

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && void requestClose()}
      title={note ? t('editor.editTitle', { type: t(`types.${draft.type}`) }) : t('editor.newTitle')}
      onEscapeKeyDown={(e) => {
        if (dirty) {
          e.preventDefault();
          void requestClose();
        }
      }}
      onPointerDownOutside={(e) => {
        if (dirty) {
          e.preventDefault();
          void requestClose();
        }
      }}
    >
      {loading && !note ? (
        <div className="grid flex-1 place-items-center">
          <Spinner />
        </div>
      ) : (
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          {/* Header */}
          <div className="flex h-16 shrink-0 items-center gap-2 border-b border-line px-4 sm:px-5">
            {readOnly ? (
              <TypeBadge type={draft.type} className="h-7 px-3" />
            ) : (
              <Menu>
                <MenuTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-1 rounded-full"
                    aria-label={t('editor.type')}
                  >
                    <TypeBadge type={draft.type} className="h-7 px-3" />
                    <ChevronDown className="size-3.5 text-muted" />
                  </button>
                </MenuTrigger>
                <MenuContent align="start">
                  {NOTE_TYPES.map((type) => {
                    const Icon = TYPE_ICONS[type];
                    return (
                      <MenuItem
                        key={type}
                        icon={<Icon style={{ color: `var(--t-${type})` }} />}
                        onSelect={() => set('type', type)}
                      >
                        {t(`types.${type}`)}
                      </MenuItem>
                    );
                  })}
                </MenuContent>
              </Menu>
            )}

            {emergency ? null : readOnly || writableVaults.length === 0 ? (
              currentVault ? (
                <Badge>
                  <Users className="size-3.5" aria-hidden /> {currentVault.name}
                </Badge>
              ) : null
            ) : (
              <Menu>
                <MenuTrigger asChild>
                  <button
                    type="button"
                    className="flex h-7 items-center gap-1.5 rounded-full border border-line-strong px-2.5 text-xs font-medium text-fg-2 hover:text-fg"
                    aria-label={t('editor.vault')}
                  >
                    {currentVault ? <Users className="size-3.5" /> : <User className="size-3.5" />}
                    <span className="max-w-28 truncate">
                      {currentVault ? currentVault.name : t('vaults.personal')}
                    </span>
                    <ChevronDown className="size-3 text-muted" />
                  </button>
                </MenuTrigger>
                <MenuContent align="start">
                  <MenuLabel>{t('editor.moveTo')}</MenuLabel>
                  <MenuItem icon={<User />} onSelect={() => set('vaultId', null)}>
                    {t('vaults.personal')}
                  </MenuItem>
                  {writableVaults.map((v) => (
                    <MenuItem key={v.id} icon={<Users />} onSelect={() => set('vaultId', v.id)}>
                      {v.name}
                    </MenuItem>
                  ))}
                </MenuContent>
              </Menu>
            )}

            <div className="ml-auto flex items-center gap-1">
              {readOnly ? null : (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-pressed={draft.pinned}
                  aria-label={draft.pinned ? t('notes.unpin') : t('notes.pin')}
                  title={draft.pinned ? t('notes.unpin') : t('notes.pin')}
                  onClick={() => set('pinned', !draft.pinned)}
                  className={cn(draft.pinned && 'text-accent-text')}
                >
                  <Pin className={cn(draft.pinned && 'fill-current')} />
                </Button>
              )}
              {note && !emergency ? (
                <Menu>
                  <MenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label={t('common.more')}>
                      <Ellipsis />
                    </Button>
                  </MenuTrigger>
                  <MenuContent>
                    <MenuItem icon={<History />} onSelect={() => setHistoryOpen(true)}>
                      {t('editor.history')}
                    </MenuItem>
                    {draft.type === 'matter' || draft.type === 'wifi' ? (
                      <MenuItem icon={<Printer />} onSelect={() => navigate(`/print?ids=${note.id}`)}>
                        {t('print.action')}
                      </MenuItem>
                    ) : null}
                    <MenuItem icon={<BookmarkPlus />} onSelect={() => setTemplateOpen(true)}>
                      {t('templates.saveAs')}
                    </MenuItem>
                    {readOnly ? null : (
                      <>
                        <MenuSeparator />
                        <MenuItem icon={<Trash2 />} danger onSelect={() => void remove()}>
                          {t('common.delete')}
                        </MenuItem>
                      </>
                    )}
                  </MenuContent>
                </Menu>
              ) : null}
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('common.close')}
                onClick={() => void requestClose()}
              >
                <X className="!size-[18px]" />
              </Button>
            </div>
          </div>

          {/* Body */}
          <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 py-6 sm:px-6">
            {readOnly ? (
              <p className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-xs text-fg-2">
                <LockKeyhole className="size-3.5" aria-hidden />
                {emergency ? t('emergency.readOnly') : t('editor.readOnly')}
              </p>
            ) : null}

            <input
              ref={titleRef}
              value={draft.title}
              onChange={(e) => set('title', e.target.value)}
              placeholder={t('editor.titlePlaceholder')}
              aria-label={t('editor.titlePlaceholder')}
              maxLength={200}
              readOnly={readOnly}
              className="w-full bg-transparent text-2xl font-semibold tracking-tight outline-none placeholder:text-muted/70"
            />

            {draft.type === 'matter' ? (
              <MatterPanel
                setupCode={draft.fields.setupCode ?? ''}
                qrPayload={draft.fields.qrPayload ?? ''}
                onScan={() => setScanTarget('matter')}
                onEnlarge={() => setQrOpen(true)}
                readOnly={readOnly}
              />
            ) : null}

            {defs.length ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {defs.map((def) => (
                  <FieldInput
                    key={`${draft.type}.${def.key}`}
                    type={draft.type}
                    def={def}
                    value={draft.fields[def.key] ?? ''}
                    onChange={(v) => setFields({ [def.key]: v })}
                    readOnly={readOnly}
                    onScan={
                      def.kind === 'totp'
                        ? () => setScanTarget('totp')
                        : def.kind === 'matterQr'
                          ? () => setScanTarget('matter')
                          : undefined
                    }
                  />
                ))}
              </div>
            ) : null}

            {draft.type === 'wifi' ? (
              <div className="flex items-center gap-4 rounded-2xl border border-line bg-surface-1 p-4">
                {wifiQr ? (
                  <QrCode value={wifiQr} label={t('editor.wifiQr')} className="size-28 shrink-0 p-2" />
                ) : null}
                <div className="flex flex-col gap-2">
                  <span className="text-sm font-medium">{t('editor.wifiQr')}</span>
                  <span className="text-xs text-muted">
                    {wifiQr ? t('editor.wifiQrHint') : t('scan.wifiHint')}
                  </span>
                  {readOnly ? null : (
                    <div>
                      <Button size="sm" variant="ghost" onClick={() => setScanTarget('wifi')}>
                        <ScanQrCode /> {t('scan.button')}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            <CustomFields
              value={draft.customFields}
              onChange={(list) => set('customFields', list)}
              readOnly={readOnly}
            />

            <Field
              label={
                <span className="flex items-center gap-1.5">
                  <CalendarClock className="size-3.5" aria-hidden /> {t('editor.expiresAt')}
                </span>
              }
              hint={t('editor.expiresHint')}
            >
              {(a) => (
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    {...a}
                    type="date"
                    value={draft.expiresAt ?? ''}
                    onChange={(e) => set('expiresAt', e.target.value || null)}
                    readOnly={readOnly}
                    className="w-auto min-w-44"
                  />
                  {cardExpiry && cardExpiry !== draft.expiresAt && !readOnly ? (
                    <Button size="sm" variant="ghost" onClick={() => set('expiresAt', cardExpiry)}>
                      {t('editor.useCardExpiry', { date: draft.fields.expiry })}
                    </Button>
                  ) : null}
                  {draft.expiresAt && !readOnly ? (
                    <Button size="sm" variant="ghost" onClick={() => set('expiresAt', null)}>
                      {t('common.remove')}
                    </Button>
                  ) : null}
                </div>
              )}
            </Field>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-medium text-fg-2">{t('editor.content')}</span>
                {readOnly ? null : (
                  <Segmented
                    label={t('editor.content')}
                    value={mode}
                    onChange={setMode}
                    options={[
                      { value: 'write', label: t('editor.write') },
                      { value: 'preview', label: t('editor.preview') },
                    ]}
                  />
                )}
              </div>
              {mode === 'write' && !readOnly ? (
                <textarea
                  value={draft.content}
                  onChange={(e) => set('content', e.target.value)}
                  placeholder={t('editor.contentPlaceholder')}
                  aria-label={t('editor.content')}
                  rows={contentRows}
                  className={cn(inputClass, 'resize-y py-3 leading-relaxed')}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => !readOnly && setMode('write')}
                  className="min-h-24 rounded-[10px] border border-line bg-surface-1 px-4 py-3 text-left"
                >
                  {draft.content.trim() ? (
                    <Suspense fallback={<Spinner />}>
                      <MarkdownView source={draft.content} />
                    </Suspense>
                  ) : (
                    <span className="text-sm text-muted">{t('editor.emptyPreview')}</span>
                  )}
                </button>
              )}
            </div>

            {readOnly ? (
              draft.tags.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {draft.tags.map((tag) => (
                    <span key={tag} className="rounded-md bg-surface-3 px-2 py-0.5 text-xs text-fg-2">
                      #{tag}
                    </span>
                  ))}
                </div>
              ) : null
            ) : (
              <TagInput value={draft.tags} onChange={(tags) => set('tags', tags)} suggestions={allTags} />
            )}

            <Attachments
              noteId={note?.id ?? null}
              files={note?.attachments ?? []}
              readOnly={readOnly}
              load={emergency && note ? (file) => emergency.loadAttachment(note.id, file) : undefined}
            />
          </div>

          {/* Footer */}
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line px-4 py-3 sm:px-6 sm:py-4">
            <span className="mr-auto flex items-center gap-1.5 text-xs text-muted">
              <LockKeyhole className="size-3.5" aria-hidden />
              {t('editor.encrypted')}
              {note
                ? ` · ${t('editor.updated', { time: relativeTime(note.updatedAt, i18n.language, t('common.justNow')) })}`
                : ''}
            </span>
            {readOnly ? (
              <Button onClick={onClose}>{t('common.close')}</Button>
            ) : (
              <>
                {note ? (
                  <Button
                    variant="danger-outline"
                    onClick={remove}
                    loading={trash.isPending}
                    className="max-sm:hidden"
                  >
                    <Trash2 /> {t('common.delete')}
                  </Button>
                ) : null}
                <Button
                  type="submit"
                  variant="primary"
                  loading={saving}
                  disabled={!dirty && Boolean(note)}
                  aria-keyshortcuts="Meta+S Control+S"
                >
                  {note ? t('common.save') : t('editor.create')}
                </Button>
              </>
            )}
          </div>
        </form>
      )}

      {matterInfo ? (
        <Dialog open={qrOpen} onOpenChange={setQrOpen} title={draft.title || t('types.matter')}>
          <QrCode
            value={draft.fields.qrPayload!.trim()}
            label={t('editor.matterQrAlt')}
            className="mx-auto aspect-square w-full max-w-80"
          />
          <p className="text-center font-mono text-xl tracking-wide">
            {draft.fields.setupCode ? formatMatterCode(draft.fields.setupCode) : ''}
          </p>
        </Dialog>
      ) : null}

      <QrScanner
        open={scanTarget !== null}
        onOpenChange={(o) => !o && setScanTarget(null)}
        onResult={onScanned}
        hint={scanTarget ? t(`scan.hint_${scanTarget}`) : undefined}
      />

      {note && !emergency ? (
        <VersionsDialog
          noteId={note.id}
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          canRestore={!readOnly}
          onRestored={() => {
            loadedKey.current = null;
          }}
        />
      ) : null}

      <SaveTemplateDialog open={templateOpen} onOpenChange={setTemplateOpen} draft={draft} />
    </Sheet>
  );
}

function SaveTemplateDialog({
  open,
  onOpenChange,
  draft,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: Draft;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setName(draft.title);
  }, [open, draft.title]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('templates.saveAs')}
      description={t('templates.saveText')}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            // Secrets are not copied into templates – only structure, labels and non-secret values.
            const fields = Object.fromEntries(
              Object.entries(cleanFields(draft.type, draft.fields)).filter(
                ([k]) =>
                  !['password', 'totp', 'number', 'cvc', 'pin', 'value', 'setupCode', 'qrPayload'].includes(
                    k,
                  ),
              ),
            );
            await api.templates.create({
              name,
              type: draft.type,
              title: draft.title,
              content: draft.content,
              fields,
              customFields: cleanCustom(draft.customFields).map((f) => ({
                ...f,
                value: f.secret ? '' : f.value,
              })),
              tags: draft.tags,
            });
            toast.success(t('templates.saved'));
            void qc.invalidateQueries({ queryKey: ['templates'] });
            onOpenChange(false);
          } catch (err) {
            toast.error(errorMessage(err, t));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label={t('templates.name')}>
          {(a) => (
            <Input
              {...a}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={80}
              autoFocus
            />
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
