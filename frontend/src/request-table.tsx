import { QueueRequest } from './api';
import { formatSubmitted, requestStageLabel, stageClass } from './request-stage';

export const requestColumn = {
  id: 'ID',
  title: 'Title',
  submitter: 'Submitter',
  employeeDepartment: 'Employee Department',
  destinationDepartment: 'Destination Department',
  submittedAt: 'Submitted At',
  workStatus: 'Work Status',
  stage: 'Request Stage',
  approvalState: 'Approval Status',
} as const;

export function ClampedTitle({
  text,
  buttonId,
  onOpen,
}: {
  text: string;
  buttonId?: string;
  onOpen?: () => void;
}) {
  if (!onOpen) {
    return <span className="cell-clamp">{text}</span>;
  }
  return (
    <button id={buttonId} className="link-button cell-clamp" type="button" onClick={onOpen}>
      {text}
    </button>
  );
}

export function ReadableText({ text }: { text: string }) {
  return <span className="cell-nowrap">{text}</span>;
}

export function ClippedText({ text }: { text: string }) {
  return <span className="cell-clip">{text}</span>;
}

export function SubmissionTable({
  testId,
  items,
  selectedId,
  emptyLabel,
  rowFocusId,
  onOpen,
  canOpenItem,
}: {
  testId: string;
  items: QueueRequest[];
  selectedId: number | null;
  emptyLabel: string;
  rowFocusId: (id: number) => string;
  onOpen: (item: QueueRequest) => void;
  canOpenItem?: (item: QueueRequest) => boolean;
}) {
  return (
    <div className="table-wrap">
      <table className="data-table request-table" data-testid={testId}>
        <colgroup>
          <col className="col-id" />
          <col className="col-title" />
          <col className="col-submitter" />
          <col className="col-department" />
          <col className="col-submitted" />
          <col className="col-state" />
        </colgroup>
        <thead>
          <tr>
            <th className="col-id" scope="col">{requestColumn.id}</th>
            <th className="col-title" scope="col">{requestColumn.title}</th>
            <th className="col-submitter" scope="col">{requestColumn.submitter}</th>
            <th className="col-department" scope="col">{requestColumn.destinationDepartment}</th>
            <th className="col-submitted" scope="col">{requestColumn.submittedAt}</th>
            <th className="col-state" scope="col">{requestColumn.stage}</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td className="table-empty" colSpan={6}>
                {emptyLabel}
              </td>
            </tr>
          ) : (
            items.map((item) => {
              const label = requestStageLabel(item);
              const openable = canOpenItem ? canOpenItem(item) : true;
              return (
                <tr key={item.id} className={selectedId === item.id ? 'row-selected' : undefined}>
                  <td className="col-id">
                    {openable ? (
                      <button className="link-button" type="button" onClick={() => onOpen(item)}>
                        #{item.id}
                      </button>
                    ) : (
                      <span>#{item.id}</span>
                    )}
                  </td>
                  <td className="col-title">
                    <ClampedTitle
                      text={item.title ? item.title : 'Untitled request'}
                      buttonId={openable ? rowFocusId(item.id) : undefined}
                      onOpen={openable ? () => onOpen(item) : undefined}
                    />
                  </td>
                  <td className="col-submitter">
                    <ReadableText text={item.submitter.name} />
                  </td>
                  <td className="col-department">
                    <ClippedText text={item.department.name} />
                  </td>
                  <td className="col-submitted">
                    <ReadableText text={formatSubmitted(item.submittedAt)} />
                  </td>
                  <td className="col-state">
                    <span className={stageClass(label)}>{label}</span>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
