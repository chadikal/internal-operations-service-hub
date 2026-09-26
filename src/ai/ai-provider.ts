export const AI_PROVIDER = 'AI_PROVIDER';

export type AiDepartmentContext = {
  id: number;
  name: string;
};

export type AiRequestTypeContext = {
  id: number;
  name: string;
  departmentId: number;
};

export type AiProviderInput = {
  employeeText: string;
  departments: AiDepartmentContext[];
  requestTypes: AiRequestTypeContext[];
};

export interface AiProvider {
  complete(input: AiProviderInput): Promise<unknown>;
}
