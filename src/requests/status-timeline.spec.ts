import { buildStatusTimeline, statusTimelineChain, TimelineRequest } from './status-timeline';

function request(overrides: Partial<TimelineRequest> = {}): TimelineRequest {
  return {
    submittedAt: '2026-09-28T09:00:00.000Z',
    status: 'SUBMITTED',
    approvalState: 'NOT_REQUIRED',
    capturedApprovalPolicy: 'NONE',
    currentOwnerId: null,
    submitter: { name: 'John' },
    currentOwner: null,
    approvalDecision: null,
    ...overrides,
  };
}

describe('status timeline', () => {
  it('does not invent approval steps when approval is not required', () => {
    const chain = statusTimelineChain(request(), []);
    expect(chain).toBe('Submitted → Unclaimed');
    expect(chain).not.toContain('Awaiting Approval');
    expect(chain).not.toContain('Approved');
  });

  it('stops a pending approval at Awaiting Approval', () => {
    expect(
      statusTimelineChain(
        request({ approvalState: 'PENDING', capturedApprovalPolicy: 'DEPARTMENT_ADMIN' }),
        [],
      ),
    ).toBe('Submitted → Awaiting Approval');
  });

  it('includes Awaiting Approval and Approved, then the work lifecycle, without changing work status', () => {
    const stored = request({
      status: 'IN_PROGRESS',
      approvalState: 'APPROVED',
      capturedApprovalPolicy: 'SUPER_ADMIN',
      currentOwnerId: 4,
      currentOwner: { name: 'Chadi' },
      approvalDecision: {
        decision: 'APPROVED',
        decidedAt: '2026-09-28T10:00:00.000Z',
        approver: { name: 'Ada' },
      },
    });
    expect(stored.status).toBe('IN_PROGRESS');
    expect(
      statusTimelineChain(stored, [
        { newStatus: 'IN_PROGRESS', changedAt: '2026-09-28T11:00:00.000Z', changedByEmployee: { name: 'Chadi' } },
      ]),
    ).toBe('Submitted → Awaiting Approval → Approved → Unclaimed → Claimed → In Progress');
  });

  it('ends a denial at Denied and ignores later work changes', () => {
    const steps = buildStatusTimeline(
      request({
        approvalState: 'DENIED',
        capturedApprovalPolicy: 'DEPARTMENT_ADMIN',
        approvalDecision: {
          decision: 'DENIED',
          decidedAt: '2026-09-28T10:00:00.000Z',
          approver: { name: 'Ada' },
        },
      }),
      [{ newStatus: 'IN_PROGRESS', changedAt: '2026-09-28T11:00:00.000Z', changedByEmployee: { name: 'Chadi' } }],
    );
    expect(steps.map((step) => step.label)).toEqual(['Submitted', 'Awaiting Approval', 'Denied']);
    expect(steps[2].detail).toContain('by Ada');
  });

  it('shows a claim time only when claimedAt was stored', () => {
    const owned = request({
      currentOwnerId: 4,
      currentOwner: { name: 'Chadi' },
    });
    const legacy = buildStatusTimeline(owned, []).find((step) => step.label === 'Claimed');
    expect(legacy?.detail).toBe('by Chadi');

    const claimedAt = '2026-09-28T10:15:00.000Z';
    const recorded = buildStatusTimeline({ ...owned, claimedAt }, []).find((step) => step.label === 'Claimed');
    expect(recorded?.detail).toBe(`by Chadi · ${new Date(claimedAt).toLocaleString()}`);
  });
});
