/*
 * Placeholder used by sidebar menu items whose backend feature hasn't
 * landed yet. Keeps the route addressable so the sidebar doesn't 404.
 */
import { Hammer, type LucideIcon } from 'lucide-react';

export function ComingSoon({
  title,
  description,
  icon: Icon = Hammer,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-6">
      <div className="w-20 h-20 rounded-full bg-primary-50 text-primary flex items-center justify-center ring-4 ring-primary/10">
        <Icon className="w-9 h-9" />
      </div>
      <h1 className="mt-6 text-2xl font-semibold text-ink-900">{title}</h1>
      <p className="mt-2 text-sm text-ink-500 max-w-md">
        {description ?? 'This module is being rebuilt as part of the EasyFix Client Portal migration. Check back soon.'}
      </p>
      <span className="mt-5 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary-100 text-primary text-xs font-semibold ring-1 ring-primary/20">
        Coming soon
      </span>
    </div>
  );
}
