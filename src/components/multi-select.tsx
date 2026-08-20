'use client';

/*
 * MultiSelect — popover dropdown with optional inline search & checkboxes.
 *
 * Powers the order-history filter bar's City / Client Team / Bucket
 * pickers. Replaces what the legacy Angular dashboard built with
 * <mat-select multiple> + a search <mat-form-field>.
 *
 * Contract:
 *   options    — { value, label }[]
 *   value      — current selected value array (controlled)
 *   onChange   — new array on every toggle
 *   label      — placeholder when nothing's selected
 *   searchable — show the inline search box (defaults to true when >6 options)
 *
 * Closes on outside-click. The popover sits ABOVE adjacent inputs via z-30
 * + the row container's `relative` positioning.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export type MultiSelectOption<T extends string | number> = {
  value: T;
  label: string;
};

type Props<T extends string | number> = {
  options: MultiSelectOption<T>[];
  value: T[];
  onChange: (next: T[]) => void;
  label: string;
  searchable?: boolean;
  className?: string;
  disabled?: boolean;
};

export function MultiSelect<T extends string | number>({
  options, value, onChange, label, searchable, className, disabled,
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  const showSearch = searchable ?? options.length > 6;

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((o) => o.label.toLowerCase().includes(needle));
  }, [options, q]);

  const selectedSet = useMemo(() => new Set(value), [value]);

  function toggle(v: T) {
    if (selectedSet.has(v)) {
      onChange(value.filter((x) => x !== v));
    } else {
      onChange([...value, v]);
    }
  }

  function clearAll(e: React.MouseEvent) {
    e.stopPropagation();
    onChange([]);
  }

  const buttonLabel = value.length === 0
    ? label
    : value.length === 1
      ? options.find((o) => o.value === value[0])?.label ?? `${value[0]}`
      : `${label} · ${value.length} selected`;

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border bg-surface text-left text-sm transition',
          'border-ink-100 hover:border-ink-300 focus:outline-none focus:ring-2 focus:ring-primary/30',
          value.length > 0 ? 'text-ink-900' : 'text-ink-500',
          disabled && 'opacity-60 cursor-not-allowed'
        )}
      >
        <span className="truncate">{buttonLabel}</span>
        <span className="flex items-center gap-1 shrink-0">
          {value.length > 0 && (
            <span
              role="button"
              tabIndex={0}
              onClick={clearAll}
              className="p-0.5 rounded hover:bg-ink-100 text-ink-300 hover:text-ink-700"
              aria-label="Clear selection"
            >
              <X className="w-3.5 h-3.5" />
            </span>
          )}
          <ChevronDown className={cn('w-4 h-4 text-ink-300 transition', open && 'rotate-180')} />
        </span>
      </button>

      {open && (
        <div className="absolute z-30 mt-1 left-0 right-0 min-w-[220px] bg-surface border border-ink-100 rounded-lg shadow-lg max-h-72 overflow-hidden flex flex-col">
          {showSearch && (
            <div className="relative border-b border-ink-100 p-2">
              <Search className="w-3.5 h-3.5 absolute left-4 top-1/2 -translate-y-1/2 text-ink-300" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search…"
                className="w-full pl-8 pr-2 py-1.5 text-sm border border-ink-100 rounded outline-none focus:border-primary"
              />
            </div>
          )}
          <ul className="flex-1 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <li className="px-3 py-3 text-xs text-ink-300 text-center">No matches</li>
            )}
            {filtered.map((o) => {
              const checked = selectedSet.has(o.value);
              return (
                <li key={String(o.value)}>
                  <button
                    type="button"
                    onClick={() => toggle(o.value)}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-primary-50/60',
                      checked && 'text-ink-900 font-medium'
                    )}
                  >
                    <span className={cn(
                      'w-4 h-4 rounded border flex items-center justify-center shrink-0 transition',
                      checked ? 'bg-primary border-primary' : 'border-ink-300 bg-surface'
                    )}>
                      {checked && <Check className="w-3 h-3 text-white" />}
                    </span>
                    <span className="truncate">{o.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
