import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { MeDto } from '@tresor/shared';
import { RotateCcw, ServerCrash } from 'lucide-react';
import { lazy, Suspense, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  createBrowserRouter,
  Navigate,
  Outlet,
  RouterProvider,
  useLocation,
  useNavigate,
  useOutletContext,
} from 'react-router';
import { Toaster } from 'sonner';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { ConfirmProvider } from '@/components/ui/confirm';
import { EmptyState, FullPageSpinner } from '@/components/ui/misc';
import { ME_KEY, useMe } from '@/hooks/auth';
import { setLanguage } from '@/i18n';
import { ApiError, api, forgetKeys, onKeysForgotten, onUnauthorized, restoreKeys } from '@/lib/api';
import { applyTheme } from '@/lib/theme';
import { LoginPage, RecoverPage, SetupPage, WelcomePage } from '@/pages/auth';
import { DashboardPage } from '@/pages/DashboardPage';
import { InsecurePage, isSecureEnough } from '@/pages/InsecurePage';
import { NotesPage } from '@/pages/NotesPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

const AdminPage = lazy(() => import('@/pages/AdminPage').then((m) => ({ default: m.AdminPage })));
const SettingsPage = lazy(() => import('@/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const TrashPage = lazy(() => import('@/pages/TrashPage').then((m) => ({ default: m.TrashPage })));
const DevicesPage = lazy(() => import('@/pages/DevicesPage').then((m) => ({ default: m.DevicesPage })));
const SharingPage = lazy(() => import('@/pages/SharingPage').then((m) => ({ default: m.SharingPage })));
const EmergencyPage = lazy(() => import('@/pages/EmergencyPage').then((m) => ({ default: m.EmergencyPage })));
const PrintPage = lazy(() => import('@/pages/PrintPage').then((m) => ({ default: m.PrintPage })));

const lazyPage = (node: React.ReactNode) => <Suspense fallback={<FullPageSpinner />}>{node}</Suspense>;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err) => !(err instanceof ApiError && err.status > 0 && err.status < 500) && count < 2,
      refetchOnWindowFocus: true,
    },
  },
});

// A revoked or expired session: drop every cached (decrypted) query and show the login screen.
onUnauthorized(() => {
  forgetKeys();
  if (!queryClient.getQueryData(ME_KEY)) return;
  queryClient.clear();
  queryClient.setQueryData(ME_KEY, null);
});

// Another tab signed out or locked: lock this one as well.
onKeysForgotten(() => {
  queryClient.clear();
  queryClient.setQueryData(ME_KEY, null);
});

/** Gate for everything behind the login. Exposes the current user as outlet context. */
function Protected() {
  const { t } = useTranslation();
  const me = useMe();
  const location = useLocation();
  const user = me.data;

  const language = user?.language;
  const theme = user?.theme;
  useEffect(() => {
    if (language) setLanguage(language);
    if (theme) applyTheme(theme);
  }, [language, theme]);

  if (me.isLoading) return <FullPageSpinner />;
  if (me.isError) {
    return (
      <div className="grid min-h-dvh place-items-center p-6">
        <EmptyState
          icon={<ServerCrash />}
          title={t('errors.NETWORK')}
          action={
            <Button onClick={() => void me.refetch()}>
              <RotateCcw /> {t('common.retry')}
            </Button>
          }
        />
      </div>
    );
  }
  if (!user) {
    const next =
      location.pathname === '/' ? '' : `?next=${encodeURIComponent(location.pathname + location.search)}`;
    return <Navigate to={`/login${next}`} replace />;
  }
  if (user.mustChangePassword && location.pathname !== '/welcome') return <Navigate to="/welcome" replace />;
  return <Unlocked user={user} />;
}

/**
 * The keys live only in this browser. After a reload they are re-opened with the session key; if that is not
 * possible (storage cleared, other device) the session is ended and the user signs in again.
 */
function Unlocked({ user }: { user: MeDto }) {
  const navigate = useNavigate();
  const keys = useQuery({
    queryKey: ['keys', user.id],
    queryFn: () => restoreKeys(user),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    retry: false,
  });
  const ok = keys.data === true;
  useEffect(() => {
    if (keys.data !== false) return;
    void api.logout().finally(() => {
      forgetKeys();
      queryClient.clear();
      queryClient.setQueryData(ME_KEY, null);
      navigate('/login?locked=1', { replace: true });
    });
  }, [keys.data, navigate]);
  if (!ok) return <FullPageSpinner />;
  return <Outlet context={user} />;
}

function Shell() {
  const me = useOutletContext<MeDto>();
  return <AppShell me={me} />;
}

function AdminOnly() {
  const me = useOutletContext<MeDto>();
  return me.role === 'admin' ? <Outlet context={me} /> : <Navigate to="/" replace />;
}

function GuestOnly() {
  const me = useMe();
  if (me.isLoading) return <FullPageSpinner />;
  if (me.data) return <Navigate to={me.data.mustChangePassword ? '/welcome' : '/'} replace />;
  return <Outlet />;
}

const router = createBrowserRouter([
  {
    element: <GuestOnly />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/setup', element: <SetupPage /> },
      { path: '/recover', element: <RecoverPage /> },
    ],
  },
  {
    element: <Protected />,
    children: [
      { path: '/welcome', element: <WelcomePage /> },
      { path: '/print', element: lazyPage(<PrintPage />) },
      {
        element: <Shell />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: 'notes', element: <NotesPage /> },
          { path: 'trash', element: lazyPage(<TrashPage />) },
          { path: 'devices', element: lazyPage(<DevicesPage />) },
          { path: 'sharing', element: lazyPage(<SharingPage />) },
          { path: 'emergency', element: lazyPage(<EmergencyPage />) },
          { path: 'settings', element: lazyPage(<SettingsPage />) },
          { element: <AdminOnly />, children: [{ path: 'admin', element: lazyPage(<AdminPage />) }] },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);

export function App() {
  if (!isSecureEnough()) return <InsecurePage />;
  return (
    <QueryClientProvider client={queryClient}>
      <ConfirmProvider>
        <RouterProvider router={router} />
      </ConfirmProvider>
      <Toaster
        position="bottom-right"
        closeButton
        toastOptions={{
          style: {
            background: 'var(--surface-1)',
            color: 'var(--fg)',
            border: '1px solid var(--line-strong)',
            borderRadius: '14px',
            fontFamily: 'var(--font-sans)',
            boxShadow: 'var(--shadow-lg)',
          },
        }}
      />
    </QueryClientProvider>
  );
}
