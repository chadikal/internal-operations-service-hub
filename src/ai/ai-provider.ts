export const AI_PROVIDER = 'AI_PROVIDER';

export type AiDepartmentContext = {
  id: number;
  name: string;
};

export type AiProviderInput = {
  employeeText: string;
  departments: AiDepartmentContext[];
};

export interface AiProvider {
  complete(input: AiProviderInput): Promise<unknown>;
}
