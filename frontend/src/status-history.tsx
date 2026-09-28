import { HistoryRecord, ServiceRequest } from './api';
import { buildStatusTimeline } from '../../src/requests/status-timeline.ts';

export function StatusHistory({ request, history }: { request: ServiceRequest; history: HistoryRecord[] }) {
  const steps = buildStatusTimeline(request, history);
  return (
    <div data-testid="status-history">
      <ol className="timeline">
        {steps.map((step, index) => (
          <li key={`${step.label}-${index}`}>
            <strong>{step.label}</strong>
            {step.detail ? <span>{step.detail}</span> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
