import { Transform } from 'class-transformer';
import { IsIn, IsOptional } from 'class-validator';

function optionalStatus({ obj }: { obj: unknown }) {
  if (typeof obj !== 'object' || obj === null || !Object.prototype.hasOwnProperty.call(obj, 'status')) {
    return undefined;
  }
  const raw = (obj as Record<string, unknown>).status;
  if (typeof raw !== 'string') {
    return raw;
  }
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export class ListApprovalsQueryDto {
  @Transform(optionalStatus)
  @IsOptional()
  @IsIn(['all', 'awaiting', 'approved', 'denied'])
  status?: 'all' | 'awaiting' | 'approved' | 'denied';
}
