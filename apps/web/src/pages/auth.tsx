import type { Language, MeDto } from '@tresor/shared';
import { FingerprintPattern, LockKeyhole, Smartphone, TriangleAlert } from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { LogoMark, VaultDial } from '@/components/layout/Logo';
import { NewPasswordFields, passwordsValid } from '@/components/PasswordFields';
import { RecoveryKeyDialog } from '@/components/RecoveryKeyDialog';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/input';
import { Segmented } from '@/components/ui/misc';
import { useApplyUser, useLock, useMe } from '@/hooks/auth';
import { setLanguage } from '@/i18n';
import { ApiError, api } from '@/lib/api';
import { errorMessage } from '@/lib/utils';
import { getPasskey, passkeysSupported } from '@/lib/webauthn';

/** Only same-app paths are allowed as redirect targets after sign-in (no "//evil.example"). */
function safeNext(next: string | null): string {
  return next && /^\/(?![/\\])/.test(next) ? next : '/';
}

function Alert({ children, tone = 'danger' }: { children: ReactNode; tone?: 'danger' | 'info' }) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={
        tone === 'danger'
          ? 'flex gap-2.5 rounded-xl border border-danger/25 bg-danger-soft p-3 text-[13px] text-danger-text'
          : 'flex gap-2.5 rounded-xl border border-line-strong bg-surface-2 p-3 text-[13px] text-fg-2'
      }
    >
      {tone === 'danger' ? (
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      ) : (
        <LockKeyhole className="mt-0.5 size-4 shrink-0" aria-hidden />
      )}
      <span>{children}</span>
    </div>
  );
}

/** Split layout used by all signed-out screens: brand panel left, form right. */
export function AuthLayout({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const features = [
    [t('brand.aesTitle'), t('brand.aesText')],
    [t('brand.argonTitle'), t('brand.argonText')],
    [t('brand.hostedTitle'), t('brand.hostedText')],
  ];
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <section className="relative hidden flex-col justify-between overflow-hidden border-r border-line bg-[radial-gradient(120%_80%_at_30%_40%,var(--surface-2)_0%,var(--bg)_70%)] px-12 py-10 lg:flex">
        <div className="flex items-center gap-2.5">
          <LogoMark />
          <span className="text-[17px] font-semibold">Tresor</span>
        </div>
        <div className="flex justify-center py-6">
          <VaultDial label={t('brand.dial')} className="w-full max-w-[400px]" />
        </div>
        <div className="flex max-w-xl flex-col gap-6">
          <h1 className="text-[40px] leading-[1.08] font-semibold tracking-[-0.035em] whitespace-pre-line">
            {t('brand.headline')}
          </h1>
          <div className="grid grid-cols-3 gap-5">
            {features.map(([title, text]) => (
              <div key={title} className="flex flex-col gap-1.5">
                <span className="font-mono text-xs text-accent-text">{title}</span>
                <span className="text-[13px] leading-relaxed text-fg-2">{text}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="flex flex-col px-5 py-6 sm:px-10 sm:py-10">
        <div className="flex items-center justify-between lg:justify-end">
          <span className="flex items-center gap-2.5 lg:hidden">
            <LogoMark />
            <span className="text-[17px] font-semibold">Tresor</span>
          </span>
          <Segmented
            label={t('nav.language')}
            value={i18n.language === 'de' ? 'de' : 'en'}
            onChange={(l: Language) => setLanguage(l)}
            mono
            options={[
              { value: 'de', label: 'DE', ariaLabel: 'Deutsch' },
              { value: 'en', label: 'EN', ariaLabel: 'English' },
            ]}
          />
        </div>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[380px] animate-pop-in">{children}</div>
        </div>
        <p className="flex items-center justify-center gap-2 text-xs text-muted">
          <LockKeyhole className="size-3.5" aria-hidden />
          {t('login.connection', { host: window.location.host })} · v{__APP_VERSION__}
        </p>
      </section>
    </div>
  );
}

function Heading({ title, subtitle, icon }: { title: string; subtitle: string; icon?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      {icon ? (
        <span className="mb-2 grid size-11 place-items-center rounded-xl bg-accent-soft text-accent-text [&_svg]:size-5">
          {icon}
        </span>
      ) : null}
      <h2 className="text-[28px] font-semibold tracking-[-0.025em]">{title}</h2>
      <p className="text-fg-2">{subtitle}</p>
    </div>
  );
}

function OtpInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: 6 }, (_, i) => value[i] ?? '');
  useEffect(() => refs.current[0]?.focus(), []);

  const setAt = (i: number, d: string) => {
    const next = digits.slice();
    next[i] = d;
    onChange(next.join('').slice(0, 6));
  };

  return (
    <div className="grid grid-cols-6 gap-2">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={d}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          aria-label={t('login.totpLabel', { n: i + 1 })}
          maxLength={6}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, '');
            if (v.length > 1) {
              onChange(v.slice(0, 6));
              refs.current[Math.min(5, v.length - 1)]?.focus();
              return;
            }
            setAt(i, v);
            if (v && i < 5) refs.current[i + 1]?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !d && i > 0) refs.current[i - 1]?.focus();
          }}
          className="h-14 min-w-0 rounded-xl border border-line-strong bg-surface-1 text-center font-mono text-[22px] font-medium outline-none focus:border-[color-mix(in_oklab,var(--mark)_70%,transparent)] focus:ring-4 focus:ring-accent-soft"
        />
      ))}
    </div>
  );
}

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const applyUser = useApplyUser();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [step, setStep] = useState<'password' | 'totp'>('password');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.setupStatus().then(
      (s) => s.needsSetup && navigate('/setup', { replace: true }),
      () => {},
    );
  }, [navigate]);

  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const passkeyLogin = async () => {
    setPasskeyBusy(true);
    setError(null);
    try {
      const { challengeId, options, prfSalt } = await api.passkeys.loginOptions();
      const { response, prf } = await getPasskey(options, prfSalt);
      const { user } = await api.loginWithPasskey({ challengeId, response, prf });
      applyUser(user);
      navigate(user.mustChangePassword ? '/welcome' : safeNext(params.get('next')), { replace: true });
    } catch (err) {
      if (err instanceof ApiError) setError(errorMessage(err, t));
      else if ((err as Error)?.name !== 'NotAllowedError') setError(t('passkeys.failed'));
    } finally {
      setPasskeyBusy(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = await api.login({ username, password, ...(step === 'totp' ? { totp } : {}) });
      applyUser(user);
      navigate(user.mustChangePassword ? '/welcome' : safeNext(params.get('next')), { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'TOTP_REQUIRED') {
        setStep('totp');
      } else {
        if (err instanceof ApiError && err.code === 'TOTP_INVALID') setTotp('');
        setError(errorMessage(err, t));
      }
    } finally {
      setBusy(false);
    }
  };

  // Submit automatically once all six digits are entered.
  // biome-ignore lint/correctness/useExhaustiveDependencies: fire only when the code or step changes
  useEffect(() => {
    if (step === 'totp' && totp.length === 6 && !busy) {
      void submit({ preventDefault() {} } as FormEvent);
    }
  }, [totp, step]);

  return (
    <AuthLayout>
      <form onSubmit={submit} className="flex flex-col gap-7">
        {step === 'password' ? (
          <>
            <Heading title={t('login.title')} subtitle={t('login.subtitle')} />
            {params.get('locked') ? <Alert tone="info">{t('login.locked')}</Alert> : null}
            {error ? <Alert>{error}</Alert> : null}
            <div className="flex flex-col gap-4">
              <Field label={t('login.username')}>
                {(a) => (
                  <Input
                    {...a}
                    className="h-12 rounded-xl text-[15px]"
                    autoComplete="username"
                    autoCapitalize="none"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    autoFocus
                  />
                )}
              </Field>
              <Field label={t('login.password')}>
                {(a) => (
                  <Input
                    {...a}
                    className="h-12 rounded-xl text-[15px]"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                )}
              </Field>
            </div>
            <Button type="submit" variant="primary" size="lg" loading={busy}>
              {t('login.submit')}
            </Button>
            {passkeysSupported().ok ? (
              <>
                <div className="flex items-center gap-3 text-xs text-muted" aria-hidden>
                  <span className="h-px flex-1 bg-line" />
                  {t('login.or')}
                  <span className="h-px flex-1 bg-line" />
                </div>
                <Button size="lg" onClick={() => void passkeyLogin()} loading={passkeyBusy}>
                  <FingerprintPattern className="!size-[18px]" /> {t('login.passkey')}
                </Button>
              </>
            ) : null}
            <Link to="/recover" className="text-center text-[13px] text-accent-text hover:underline">
              {t('login.forgot')}
            </Link>
          </>
        ) : (
          <>
            <Heading title={t('login.totpTitle')} subtitle={t('login.totpSubtitle')} icon={<Smartphone />} />
            {error ? <Alert>{error}</Alert> : null}
            <OtpInput value={totp} onChange={setTotp} />
            <Button type="submit" variant="primary" size="lg" loading={busy} disabled={totp.length !== 6}>
              {t('login.submit')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setStep('password');
                setTotp('');
                setError(null);
              }}
            >
              {t('common.back')}
            </Button>
          </>
        )}
      </form>
    </AuthLayout>
  );
}

export function SetupPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const applyUser = useApplyUser();
  const [form, setForm] = useState({ displayName: '', username: '', password: '', confirm: '' });
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ user: MeDto; recoveryKey: string } | null>(null);

  useEffect(() => {
    void api.setupStatus().then(
      (s) => !s.needsSetup && navigate('/login', { replace: true }),
      () => {},
    );
  }, [navigate]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!passwordsValid(form.password, form.confirm)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.setup({
        displayName: form.displayName,
        username: form.username,
        password: form.password,
        language: i18n.language === 'de' ? 'de' : 'en',
      });
      setResult(res);
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <form onSubmit={submit} className="flex flex-col gap-6">
        <Heading title={t('setup.title')} subtitle={t('setup.subtitle')} />
        {error ? <Alert>{error}</Alert> : null}
        <div className="flex flex-col gap-4">
          <Field label={t('setup.displayName')}>
            {(a) => (
              <Input
                {...a}
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                required
                autoFocus
                autoComplete="name"
              />
            )}
          </Field>
          <Field label={t('setup.username')} hint={t('setup.usernameHint')}>
            {(a) => (
              <Input
                {...a}
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase() })}
                required
                minLength={3}
                maxLength={32}
                pattern="[a-z0-9][a-z0-9._\-]*"
                autoComplete="username"
                autoCapitalize="none"
              />
            )}
          </Field>
          <NewPasswordFields
            password={form.password}
            confirm={form.confirm}
            onPassword={(v) => setForm({ ...form, password: v })}
            onConfirm={(v) => setForm({ ...form, confirm: v })}
            labels={{ password: t('setup.password'), confirm: t('setup.confirm') }}
            touched={touched}
          />
        </div>
        <Button type="submit" variant="primary" size="lg" loading={busy}>
          {t('setup.submit')}
        </Button>
      </form>
      <RecoveryKeyDialog
        recoveryKey={result?.recoveryKey ?? null}
        username={result?.user.username ?? ''}
        onDone={() => {
          if (result) applyUser(result.user);
          navigate('/', { replace: true });
        }}
      />
    </AuthLayout>
  );
}

export function RecoverPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const applyUser = useApplyUser();
  const [form, setForm] = useState({ username: '', recoveryKey: '', password: '', confirm: '' });
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ user: MeDto; recoveryKey: string } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!passwordsValid(form.password, form.confirm)) return;
    setBusy(true);
    setError(null);
    try {
      setResult(
        await api.recover({
          username: form.username,
          recoveryKey: form.recoveryKey,
          newPassword: form.password,
        }),
      );
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <form onSubmit={submit} className="flex flex-col gap-6">
        <Heading title={t('recover.title')} subtitle={t('recover.subtitle')} />
        {error ? <Alert>{error}</Alert> : null}
        <div className="flex flex-col gap-4">
          <Field label={t('recover.username')}>
            {(a) => (
              <Input
                {...a}
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                required
                autoFocus
                autoComplete="username"
                autoCapitalize="none"
              />
            )}
          </Field>
          <Field label={t('recover.recoveryKey')}>
            {(a) => (
              <Input
                {...a}
                value={form.recoveryKey}
                onChange={(e) => setForm({ ...form, recoveryKey: e.target.value.toUpperCase() })}
                required
                placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                className="font-mono text-[13px] tracking-wide"
                autoComplete="off"
                spellCheck={false}
              />
            )}
          </Field>
          <NewPasswordFields
            password={form.password}
            confirm={form.confirm}
            onPassword={(v) => setForm({ ...form, password: v })}
            onConfirm={(v) => setForm({ ...form, confirm: v })}
            labels={{ password: t('recover.newPassword'), confirm: t('recover.confirm') }}
            touched={touched}
          />
        </div>
        <Button type="submit" variant="primary" size="lg" loading={busy}>
          {t('recover.submit')}
        </Button>
        <p className="text-center text-xs text-muted">{t('recover.totpReset')}</p>
        <Link to="/login" className="text-center text-[13px] text-accent-text hover:underline">
          {t('recover.backToLogin')}
        </Link>
      </form>
      <RecoveryKeyDialog
        recoveryKey={result?.recoveryKey ?? null}
        username={result?.user.username ?? ''}
        onDone={() => {
          if (result) applyUser(result.user);
          navigate('/', { replace: true });
        }}
      />
    </AuthLayout>
  );
}

/** Forced password change for accounts created by an admin. */
export function WelcomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const me = useMe();
  const applyUser = useApplyUser();
  const lock = useLock();
  const [form, setForm] = useState({ current: '', password: '', confirm: '' });
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ user: MeDto; recoveryKey?: string } | null>(null);

  useEffect(() => {
    if (me.data && !me.data.mustChangePassword && !result) navigate('/', { replace: true });
  }, [me.data, result, navigate]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!passwordsValid(form.password, form.confirm)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.changePassword({ currentPassword: form.current, newPassword: form.password });
      if (res.recoveryKey) setResult(res);
      else {
        applyUser(res.user);
        navigate('/', { replace: true });
      }
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <form onSubmit={submit} className="flex flex-col gap-6">
        <Heading title={t('welcome.title')} subtitle={t('welcome.subtitle')} />
        {error ? <Alert>{error}</Alert> : null}
        <div className="flex flex-col gap-4">
          <Field label={t('welcome.current')}>
            {(a) => (
              <Input
                {...a}
                type="password"
                autoComplete="current-password"
                value={form.current}
                onChange={(e) => setForm({ ...form, current: e.target.value })}
                required
                autoFocus
              />
            )}
          </Field>
          <NewPasswordFields
            password={form.password}
            confirm={form.confirm}
            onPassword={(v) => setForm({ ...form, password: v })}
            onConfirm={(v) => setForm({ ...form, confirm: v })}
            labels={{ password: t('welcome.newPassword'), confirm: t('welcome.confirm') }}
            touched={touched}
          />
        </div>
        <Button type="submit" variant="primary" size="lg" loading={busy}>
          {t('welcome.submit')}
        </Button>
        <Button variant="ghost" onClick={() => void lock('logout')}>
          {t('nav.logout')}
        </Button>
      </form>
      <RecoveryKeyDialog
        recoveryKey={result?.recoveryKey ?? null}
        username={result?.user.username ?? ''}
        onDone={() => {
          if (result) applyUser(result.user);
          navigate('/', { replace: true });
        }}
      />
    </AuthLayout>
  );
}

export function LanguageSelect({ value, onChange }: { value: Language; onChange: (l: Language) => void }) {
  const { t } = useTranslation();
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value as Language)}>
      <option value="de">{t('languages.de')}</option>
      <option value="en">{t('languages.en')}</option>
    </Select>
  );
}
