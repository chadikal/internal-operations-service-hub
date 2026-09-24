import { InvalidAiOutputError } from './invalid-ai-output.error';

export type IntakeSituation = 'problem' | 'need';

export type IntakeDraft = {
  departmentId: number | null;
  summary: string | null;
  description: string | null;
};

export type IntakeResult = {
  situation: IntakeSituation;
  troubleshootingSteps: string[];
  missingInformation: string[];
  suggestions: string[];
  draft: IntakeDraft | null;
};

const RESULT_KEYS = new Set([
  'situation',
  'troubleshootingSteps',
  'missingInformation',
  'suggestions',
  'draft',
]);

const DRAFT_KEYS = new Set(['departmentId', 'summary', 'description']);

const MAX_STEPS = 3;
const MAX_STEP_LENGTH = 300;
const MAX_MISSING_ITEMS = 8;
const MAX_MISSING_LENGTH = 300;
const MAX_SUMMARY_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 2000;
const MISSING_DETAIL_MESSAGE =
  'More detail about what you need so a department and summary can be suggested.';

const GENERIC_INTAKE_WORDS = new Set([
  'a',
  'an',
  'and',
  'anything',
  'assistance',
  'can',
  'could',
  'do',
  'for',
  'get',
  'have',
  'hello',
  'help',
  'hey',
  'hi',
  'i',
  'in',
  'just',
  'like',
  'me',
  'my',
  'need',
  'needed',
  'needs',
  'of',
  'on',
  'or',
  'please',
  'really',
  'request',
  'some',
  'someone',
  'something',
  'support',
  'thank',
  'thanks',
  'the',
  'this',
  'that',
  'to',
  'want',
  'wanted',
  'we',
  'with',
  'would',
  'you',
]);

export function isActionableIntakeDraft(draft: IntakeDraft | null): boolean {
  return (
    draft != null &&
    draft.departmentId != null &&
    draft.summary != null &&
    draft.summary.trim().length > 0
  );
}

export function isInsufficientEmployeeText(text: string): boolean {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  return words.length === 0 || words.every((word) => GENERIC_INTAKE_WORDS.has(word));
}

export function validateIntakeResult(
  raw: unknown,
  allowedDepartmentIds: Set<number>,
  employeeText?: string,
): IntakeResult {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new InvalidAiOutputError('Provider output must be an object');
  }

  const obj = raw as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!RESULT_KEYS.has(key)) {
      throw new InvalidAiOutputError(`Unexpected field: ${key}`);
    }
  }

  if (obj.situation !== 'problem' && obj.situation !== 'need') {
    throw new InvalidAiOutputError('situation must be "problem" or "need"');
  }
  const situation = obj.situation;

  const missingInformation = clampStringList(
    obj.missingInformation,
    'missingInformation',
    MAX_MISSING_ITEMS,
    MAX_MISSING_LENGTH,
  );
  const suggestions = clampStringList(
    obj.suggestions,
    'suggestions',
    MAX_MISSING_ITEMS,
    MAX_MISSING_LENGTH,
  );

  let troubleshootingSteps = clampStringList(
    obj.troubleshootingSteps,
    'troubleshootingSteps',
    MAX_STEPS,
    MAX_STEP_LENGTH,
  );
  if (situation === 'need') {
    troubleshootingSteps = [];
  }

  const draft = parseDraft(obj.draft, allowedDepartmentIds, missingInformation);

  return sanitizeUnactionableResult(
    situation,
    troubleshootingSteps,
    missingInformation,
    suggestions,
    draft,
    employeeText,
  );
}

function sanitizeUnactionableResult(
  situation: IntakeSituation,
  troubleshootingSteps: string[],
  missingInformation: string[],
  suggestions: string[],
  draft: IntakeDraft | null,
  employeeText?: string,
): IntakeResult {
  const thinInput =
    employeeText !== undefined && isInsufficientEmployeeText(employeeText);

  if (thinInput || !isActionableIntakeDraft(draft)) {
    if (missingInformation.length === 0) {
      missingInformation.push(MISSING_DETAIL_MESSAGE);
    }
    return {
      situation,
      troubleshootingSteps: [],
      missingInformation,
      suggestions,
      draft: null,
    };
  }

  return {
    situation,
    troubleshootingSteps,
    missingInformation,
    suggestions,
    draft,
  };
}

function parseDraft(
  value: unknown,
  allowedDepartmentIds: Set<number>,
  missingInformation: string[],
): IntakeDraft | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new InvalidAiOutputError('draft must be an object or null');
  }

  const draft = value as Record<string, unknown>;
  for (const key of Object.keys(draft)) {
    if (!DRAFT_KEYS.has(key)) {
      throw new InvalidAiOutputError(`Unexpected draft field: ${key}`);
    }
  }

  let departmentId: number | null = null;
  if (draft.departmentId !== undefined && draft.departmentId !== null) {
    if (
      typeof draft.departmentId !== 'number' ||
      !Number.isInteger(draft.departmentId) ||
      draft.departmentId < 1
    ) {
      throw new InvalidAiOutputError('draft.departmentId must be a positive integer or null');
    }
    departmentId = draft.departmentId;
  }

  if (departmentId !== null && !allowedDepartmentIds.has(departmentId)) {
    departmentId = null;
    const message =
      'A valid department could not be determined from the allowed departments.';
    if (!missingInformation.includes(message)) {
      missingInformation.push(message);
    }
  }

  return {
    departmentId,
    summary: optionalBoundedString(draft.summary, 'draft.summary', MAX_SUMMARY_LENGTH),
    description: optionalBoundedString(
      draft.description,
      'draft.description',
      MAX_DESCRIPTION_LENGTH,
    ),
  };
}

function clampStringList(
  value: unknown,
  field: string,
  maxItems: number,
  maxLength: number,
): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new InvalidAiOutputError(`${field} must be an array of strings`);
  }

  const items: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      throw new InvalidAiOutputError(`${field} must be an array of strings`);
    }
    const trimmed = entry.trim();
    if (trimmed.length === 0) {
      continue;
    }
    items.push(trimmed.slice(0, maxLength));
    if (items.length === maxItems) {
      break;
    }
  }
  return items;
}

function optionalBoundedString(
  value: unknown,
  field: string,
  maxLength: number,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new InvalidAiOutputError(`${field} must be a string or null`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed.slice(0, maxLength);
}
