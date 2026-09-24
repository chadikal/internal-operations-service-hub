import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const RECORDS_ACTIVITY = 'recordsActivity';
export const RecordsActivity = () => SetMetadata(RECORDS_ACTIVITY, true);
