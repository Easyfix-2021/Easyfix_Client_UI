/*
 * My Wallet — withdrawn, because it had no backend and never will have this one.
 *
 * The previous page made ZERO API calls: its balance, prepaid limit, card
 * numbers ("UPI •••• 4582") and five transactions were a hardcoded array, and
 * it sat in the Extras nav where a client could open it and read invented
 * figures about their own account. It was a design mock that reached production.
 *
 * ⚠ IT CANNOT BE WIRED TO tbl_client_transaction, which is the obvious move and
 * the wrong one. That table is an ACCRUAL ledger — every amount is positive and
 * `balance` climbs as job charges land (421 -> 431 -> 441 -> 461). This page was
 * a PREPAID design: a limit, a depleting balance, a low-balance warning. Point
 * one at the other and the balance RISES as the client spends. It is dead
 * besides — no non-zero row since 2024-01-01, last real activity 2021, one
 * client.
 *
 * So what a client wallet MEANS is an open product question, not something to
 * infer from a discontinued billing table. The 221-line design is preserved in
 * git history; restore it with
 * `git checkout 8a6290b -- src/app/(authed)/wallet/page.tsx`.
 */
import { ComingSoon } from '@/components/coming-soon';

export default function WalletPage() {
  return <ComingSoon title="My Wallet" description="This section is temporarily unavailable." />;
}
