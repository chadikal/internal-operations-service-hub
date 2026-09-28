import { ApprovalCounts, MyRequestCounts, RequestWorkCounts } from './api';
import { SummaryItem } from './summary-card';

type LinkFor = (query: Record<string, string>) => Pick<SummaryItem, 'href' | 'onOpen'>;

export function requestBreakdown(counts: RequestWorkCounts, link?: LinkFor): SummaryItem[] {
  const row = (key: string, label: string, value: number, query: Record<string, string>): SummaryItem => ({
    key,
    label,
    value,
    testId: `count-${key}`,
    ...(link ? link(query) : {}),
  });
  return [
    row('submitted', 'Submitted', counts.submitted, { status: 'SUBMITTED' }),
    row('inProgress', 'In Progress', counts.inProgress, { status: 'IN_PROGRESS' }),
    row('completed', 'Completed', counts.completed, { status: 'COMPLETED' }),
    row('claimed', 'Claimed', counts.claimed, { assignment: 'assigned' }),
    row('unclaimed', 'Unclaimed', counts.unclaimed, { assignment: 'unassigned' }),
    row('active', 'Active', counts.active, { status: 'ACTIVE' }),
  ];
}

export function approvalBreakdown(
  counts: ApprovalCounts,
  prefix = 'count',
  link?: (status: string) => Pick<SummaryItem, 'href' | 'onOpen'>,
): SummaryItem[] {
  const row = (key: string, label: string, value: number, status: string): SummaryItem => ({
    key,
    label,
    value,
    testId: `${prefix}-${key}`,
    ...(link ? link(status) : {}),
  });
  return [
    row('awaiting', 'Awaiting', counts.awaiting, 'awaiting'),
    row('approved', 'Approved', counts.approved, 'approved'),
    row('denied', 'Denied', counts.denied, 'denied'),
  ];
}

export function myRequestBreakdown(counts: MyRequestCounts, link?: LinkFor): SummaryItem[] {
  const work = (key: string, label: string, value: number, query: Record<string, string>): SummaryItem => ({
    key,
    label,
    value,
    testId: `my-${key}`,
    ...(link ? link(query) : {}),
  });
  return [
    work('submitted', 'Submitted', counts.submitted, { workStatus: 'SUBMITTED' }),
    work('inProgress', 'In Progress', counts.inProgress, { workStatus: 'IN_PROGRESS' }),
    work('completed', 'Completed', counts.completed, { workStatus: 'COMPLETED' }),
    work('unclaimed', 'Unclaimed', counts.unclaimed, { assignment: 'unclaimed' }),
  ];
}
