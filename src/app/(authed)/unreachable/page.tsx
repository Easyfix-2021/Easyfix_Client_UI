'use client';

/*
 * Customer Unreachable — the rows behind the Home tile.
 *
 * Jobs where the customer could not be reached on THREE DIFFERENT DAYS inside
 * a three-day span. Three calls in one afternoon is one bad afternoon and does
 * not qualify; one call across three days is a single attempt and does not
 * either. The server counts it — tbl_job.call_later is a bit(1) flag with no
 * count and no dates, so it cannot express a pattern.
 *
 * ⚠ OPEN JOBS ONLY. A completed or cancelled job carries the same unreachable
 * history forever, and listing it would put work nobody can act on in front of
 * a client. The route applies job_status NOT IN (3,5,6,7), the SAME predicate
 * the tile's count uses, so the number and this list cannot disagree.
 *
 * VIEW ONLY for now: the row opens the job drawer and nothing else. Action
 * buttons are a later decision, and a control that did nothing would be worse
 * than none.
 */
import { PhoneOff, AlertTriangle, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useFetchOnce } from '@/lib/hooks';
import { openJobDrawer } from '@/components/job-drawer';
import { formatIst } from '@/lib/format';
import {
  PageHeader, SectionLabel, Panel, DataTable, Row, Cell, Pill,
  ActionButton, EmptyState,
} from '@/components/ui/console';

type UnreachableJob = {
  jobId: number;
  reference: string | null;
  jobStatus: number;
  city: string;
  category: string;
  ageDays: number;
  unreachableDays: number;
  attempts: number;
  lastAttempt: string | null;
};

const num = (n: number) => n.toLocaleString('en-IN');

export default function UnreachablePage() {
  const router = useRouter();
  const { data, loading, error, reload } =
    useFetchOnce<{ items: UnreachableJob[]; total: number }>('/unreachable-jobs?limit=200');

  const items = data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Customer Unreachable"
        sub={
          data
            ? `${num(data.total)} open job${data.total === 1 ? '' : 's'} · unreachable on 3 different days within 3 days`
            : 'Unreachable on 3 different days within 3 days'
        }
      />

      <SectionLabel>Repeatedly unreachable</SectionLabel>

      {loading && !data ? (
        <Panel>
          <div className="py-10 text-center">
            <Loader2 className="w-7 h-7 mx-auto animate-spin text-ink-300" aria-hidden />
            <div className="mt-2 text-sm text-ink-500">Loading unreachable jobs…</div>
          </div>
        </Panel>
      ) : error ? (
        <Panel accent="brand">
          <EmptyState
            icon={AlertTriangle}
            title="Could not load unreachable jobs"
            sub={error}
            action={<ActionButton onClick={() => void reload()}>Try Again</ActionButton>}
          />
        </Panel>
      ) : items.length === 0 ? (
        <Panel>
          {/* A genuinely good state, and it says so — an empty list here means
              nobody has been chased three days running, not that a filter is
              hiding rows. */}
          <EmptyState
            icon={PhoneOff}
            title="No repeatedly unreachable jobs"
            sub="No open job has an unreachable outcome on three different days inside a three-day span."
            action={<ActionButton onClick={() => router.push('/jobs')}>Open Jobs →</ActionButton>}
          />
        </Panel>
      ) : (
        <Panel bodyClassName="px-0 py-0">
          <DataTable
            className="rounded-none border-0"
            columns={[
              { key: 'ref', label: 'Order' },
              { key: 'city', label: 'City · work' },
              { key: 'days', label: 'Days unreachable', align: 'right' },
              { key: 'attempts', label: 'Attempts', align: 'right' },
              { key: 'last', label: 'Last attempt', align: 'right' },
              { key: 'age', label: 'Age', align: 'right' },
              { key: 'action', label: '', align: 'right' },
            ]}
          >
            {items.map((j) => (
              <Row key={j.jobId} edge={j.unreachableDays >= 5 ? 'brand' : 'warning'}>
                <Cell className="font-medium text-ink-900">{j.reference || `Job ${j.jobId}`}</Cell>
                <Cell>
                  <span className="block text-ink-900">{j.city}</span>
                  <span className="block text-xs text-ink-500">{j.category}</span>
                </Cell>
                {/* The DAYS are the finding, not the attempts: three calls in
                    one afternoon is one bad afternoon. Attempts sit beside it
                    so a reader can tell persistence from repetition. */}
                <Cell align="right">
                  <Pill accent={j.unreachableDays >= 5 ? 'brand' : 'warning'}>{num(j.unreachableDays)} days</Pill>
                </Cell>
                <Cell align="right" className="tabular-nums text-ink-500">{num(j.attempts)}</Cell>
                <Cell align="right" className="tabular-nums text-ink-500">
                  {formatIst(j.lastAttempt, { day: 'numeric', month: 'short', year: 'numeric' }, { fallback: '—' })}
                </Cell>
                <Cell align="right" className="tabular-nums">{num(j.ageDays)}d</Cell>
                <Cell align="right">
                  <ActionButton variant="ghost" onClick={() => openJobDrawer(j.jobId)}>View</ActionButton>
                </Cell>
              </Row>
            ))}
          </DataTable>
        </Panel>
      )}
    </>
  );
}
