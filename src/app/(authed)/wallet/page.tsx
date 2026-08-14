'use client';

/*
 * My Wallet — prepaid balance for EasyFix service bookings.
 *
 * ⚠️ PLACEHOLDER DATA. There is no wallet backend yet (see the prepaid-wallet
 * plan). This page renders the approved UI against a mock so the design is
 * live and reviewable. When the backend lands, replace WALLET/TXNS with:
 *   GET /api/client/wallet               → balance, limit, used, recharged
 *   GET /api/client/wallet/transactions  → the activity list
 * and wire "Recharge Wallet" to the payment-gateway order flow.
 */

import { useState } from 'react';
import Link from 'next/link';
import { openJobDrawer } from '@/components/job-drawer';
import {
  Wallet, Gauge, TrendingDown, TrendingUp, Plus, AlertTriangle,
  Receipt, PieChart, ArrowUpRight, ArrowRight, CheckCircle2, RotateCcw,
} from 'lucide-react';

// ─── Mock data (swap for the wallet API) ──────────────────────────────
const WALLET = {
  balance: 4850,
  prepaidLimit: 10000,
  used: 5150,
  recharged: 15000,
  lowBalanceThreshold: 5000,
};

type Txn = {
  id: string;
  kind: 'recharge' | 'service' | 'refund';
  title: string;
  sub: string;
  when: string;
  amount: number; // signed
  status: 'Successful' | 'Completed' | 'Refunded' | 'Pending' | 'Failed';
  jobId?: number;
};

const TXNS: Txn[] = [
  { id: 't1', kind: 'recharge', title: 'Wallet Recharge', sub: 'UPI •••• 4582',              when: '11 Aug 2026, 03:20 pm', amount:  2000, status: 'Successful' },
  { id: 't2', kind: 'service',  title: 'Service Payment',  sub: 'AC Service — Job #EF10245',   when: '10 Aug 2026, 06:30 pm', amount: -1499, status: 'Completed', jobId: 10245 },
  { id: 't3', kind: 'refund',   title: 'Refund',           sub: 'Service Cancellation — Job #EF10240', when: '09 Aug 2026, 04:15 pm', amount: 750, status: 'Refunded', jobId: 10240 },
  { id: 't4', kind: 'service',  title: 'Service Payment',  sub: 'Electrical Repair — Job #EF10238', when: '08 Aug 2026, 11:05 am', amount: -899, status: 'Completed', jobId: 10238 },
  { id: 't5', kind: 'recharge', title: 'Wallet Recharge',  sub: 'Credit Card •••• 1109',       when: '08 Aug 2026, 09:40 am', amount:  5000, status: 'Successful' },
];

const inr = (n: number) => `₹${Math.abs(n).toLocaleString('en-IN')}`;

export default function WalletPage() {
  const [notice, setNotice] = useState(false);
  const w = WALLET;
  const usedPct = Math.min(100, Math.round((w.used / w.prepaidLimit) * 100));
  const low = w.balance < w.lowBalanceThreshold;

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">My Wallet</h1>
          <p className="text-sm text-slate-500 mt-1">Prepaid balance for all your EasyFix service bookings.</p>
        </div>
        <span className="text-[11px] font-bold uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-3 py-1.5">
          Preview · sample data
        </span>
      </div>

      {/* Balance hero */}
      <div className="relative overflow-hidden rounded-3xl p-6 sm:p-7 text-white shadow-lg"
        style={{ background: 'linear-gradient(135deg,#0f766e 0%,#0d9488 55%,#14b8a6 100%)' }}>
        <div className="text-sm font-semibold text-white/80">Available Balance</div>
        <div className="text-5xl font-extrabold tracking-tight mt-1 tabular-nums">{inr(w.balance)}</div>

        {/* mini stat row */}
        <div className="mt-5 grid grid-cols-3 gap-2 rounded-2xl bg-white/10 p-4">
          {[
            { k: 'Prepaid Limit', v: w.prepaidLimit },
            { k: 'Used Amount',   v: w.used },
            { k: 'Available',     v: w.balance },
          ].map((r) => (
            <div key={r.k}>
              <div className="text-[11px] font-bold uppercase tracking-wide text-white/70">{r.k}</div>
              <div className="text-lg font-extrabold tabular-nums">{inr(r.v)}</div>
            </div>
          ))}
        </div>

        {/* progress */}
        <div className="mt-5 h-2.5 rounded-full bg-white/25 overflow-hidden">
          <div className="h-full rounded-full bg-white/90" style={{ width: `${usedPct}%` }} />
        </div>
        <div className="mt-2 text-sm text-white/85">{inr(w.used)} used of {inr(w.prepaidLimit)} prepaid limit</div>

        <button
          type="button"
          onClick={() => setNotice(true)}
          className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-white text-teal-800 font-bold px-5 py-3 shadow-sm hover:-translate-y-0.5 transition"
        >
          <Plus className="w-5 h-5" /> Recharge Wallet
        </button>
        {notice && (
          <p className="mt-2 text-xs text-white/85">Payment integration is coming soon — recharge will open your gateway here.</p>
        )}
      </div>

      {/* Low balance alert */}
      {low && (
        <div className="flex items-start gap-3 rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm p-4">
          <span className="w-10 h-10 rounded-full bg-amber-100 text-amber-600 grid place-items-center shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </span>
          <div>
            <div className="font-bold text-slate-900">Low Balance Alert</div>
            <p className="text-sm text-slate-500 mt-0.5">
              Your wallet balance is running low. Recharge now to continue booking services without interruption.
            </p>
          </div>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StatCard icon={Wallet}       tone="teal"    label="Available Balance" value={inr(w.balance)} />
        <StatCard icon={Gauge}        tone="slate"   label="Prepaid Limit"     value={inr(w.prepaidLimit)} />
        <StatCard icon={TrendingDown} tone="rose"    label="Total Used"        value={inr(w.used)} />
        <StatCard icon={TrendingUp}   tone="emerald" label="Total Recharged"   value={inr(w.recharged)} />
      </div>

      {/* Recent activity */}
      <div className="bg-white rounded-2xl ring-1 ring-slate-200 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4">
          <h2 className="text-base font-bold text-slate-900">Recent Activity</h2>
          <Link href="#" className="text-sm font-semibold text-teal-700 inline-flex items-center gap-1 hover:underline">
            All transactions <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
        <ul className="divide-y divide-slate-100">
          {TXNS.map((t) => {
            const credit = t.amount > 0;
            const Icon = t.kind === 'recharge' ? TrendingUp : t.kind === 'refund' ? RotateCcw : TrendingDown;
            const pill =
              t.status === 'Refunded' ? 'bg-teal-50 text-teal-700'
              : t.status === 'Failed' ? 'bg-rose-50 text-rose-700'
              : t.status === 'Pending' ? 'bg-amber-50 text-amber-700'
              : 'bg-emerald-50 text-emerald-700';
            return (
              <li key={t.id} className="flex items-center gap-3 px-5 py-3.5">
                <span className={`w-9 h-9 rounded-full grid place-items-center shrink-0 ${credit ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-500'}`}>
                  <Icon className="w-4 h-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-slate-900">{t.title}</div>
                  <div className="text-xs text-slate-500 truncate">
                    {t.jobId ? (
                      <button type="button" onClick={() => openJobDrawer(t.jobId!)} className="hover:text-teal-700 hover:underline">{t.sub}</button>
                    ) : t.sub}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">{t.when}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className={`text-sm font-extrabold tabular-nums ${credit ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {credit ? '+' : '−'}{inr(t.amount)}
                  </div>
                  <span className={`inline-block mt-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full ${pill}`}>{t.status}</span>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Footer cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Link href="/invoices" className="flex items-center gap-3 bg-white rounded-2xl ring-1 ring-slate-200 shadow-sm p-5 hover:ring-slate-300 transition">
          <span className="w-11 h-11 rounded-xl bg-teal-50 text-teal-700 grid place-items-center shrink-0"><Receipt className="w-5 h-5" /></span>
          <div className="flex-1 min-w-0">
            <div className="font-bold text-slate-900">Billing &amp; Invoices</div>
            <div className="text-sm text-slate-500">24 bills · Download GST invoices</div>
          </div>
          <ArrowUpRight className="w-4 h-4 text-slate-300" />
        </Link>
        <button type="button" onClick={() => setNotice(true)} className="flex items-center gap-3 bg-white rounded-2xl ring-1 ring-slate-200 shadow-sm p-5 text-left hover:ring-slate-300 transition">
          <span className="w-11 h-11 rounded-xl bg-teal-50 text-teal-700 grid place-items-center shrink-0"><PieChart className="w-5 h-5" /></span>
          <div className="flex-1 min-w-0">
            <div className="font-bold text-slate-900">Prepaid Limit</div>
            <div className="text-sm text-slate-500">Request a higher limit anytime</div>
          </div>
          <ArrowUpRight className="w-4 h-4 text-slate-300" />
        </button>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon, tone, label, value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tone: 'teal' | 'slate' | 'rose' | 'emerald';
  label: string;
  value: string;
}) {
  const toneCls = {
    teal:    'bg-teal-50 text-teal-700',
    slate:   'bg-slate-100 text-slate-500',
    rose:    'bg-rose-50 text-rose-500',
    emerald: 'bg-emerald-50 text-emerald-600',
  }[tone];
  return (
    <div className="bg-white rounded-2xl ring-1 ring-slate-200 shadow-sm p-5">
      <div className="flex items-center gap-3">
        <span className={`w-11 h-11 rounded-xl grid place-items-center ${toneCls}`}><Icon className="w-5 h-5" /></span>
        <span className="text-sm font-semibold text-slate-500">{label}</span>
      </div>
      <div className="mt-3 text-2xl font-extrabold text-slate-900 tabular-nums">{value}</div>
    </div>
  );
}
