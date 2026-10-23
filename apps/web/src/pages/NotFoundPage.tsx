import { Compass } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Card, EmptyState } from '@/components/ui/misc';

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <Card>
      <EmptyState
        icon={<Compass />}
        title={t('notFound.title')}
        text={t('notFound.text')}
        action={
          <Link
            to="/"
            className="inline-flex h-10 items-center rounded-[10px] bg-accent px-4 text-sm font-semibold text-accent-ink hover:bg-accent-hover"
          >
            {t('notFound.back')}
          </Link>
        }
      />
    </Card>
  );
}
