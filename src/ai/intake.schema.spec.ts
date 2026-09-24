import { InvalidAiOutputError } from './invalid-ai-output.error';
import {
  isActionableIntakeDraft,
  isInsufficientEmployeeText,
  validateIntakeResult,
} from './intake.schema';

const ALLOWED = new Set([1, 2, 3]);

describe('validateIntakeResult', () => {
  it('accepts a need draft for a known department', () => {
    const result = validateIntakeResult(
      {
        situation: 'need',
        troubleshootingSteps: ['ignore this for a need'],
        missingInformation: [],
        draft: {
          departmentId: 1,
          summary: 'Laptop request',
          description: 'I need a laptop.',
        },
      },
      ALLOWED,
    );

    expect(result.situation).toBe('need');
    expect(result.troubleshootingSteps).toEqual([]);
    expect(result.suggestions).toEqual([]);
    expect(result.draft?.departmentId).toBe(1);
  });

  it('caps troubleshooting steps at 3 for a problem', () => {
    const result = validateIntakeResult(
      {
        situation: 'problem',
        troubleshootingSteps: ['one', 'two', 'three', 'four'],
        missingInformation: [],
        draft: { departmentId: 1, summary: 'Wi-Fi', description: null },
      },
      ALLOWED,
    );

    expect(result.troubleshootingSteps).toEqual(['one', 'two', 'three']);
  });

  it('nulls an unknown department id instead of trusting it', () => {
    const result = validateIntakeResult(
      {
        situation: 'need',
        troubleshootingSteps: [],
        missingInformation: [],
        draft: { departmentId: 999, summary: 'Legal request', description: null },
      },
      ALLOWED,
    );

    expect(result.draft).toBeNull();
    expect(isActionableIntakeDraft(result.draft)).toBe(false);
    expect(result.missingInformation.some((item) => /allowed departments/i.test(item))).toBe(
      true,
    );
  });

  it('keeps an actionable draft when suggestions list optional extra details', () => {
    const result = validateIntakeResult(
      {
        situation: 'need',
        troubleshootingSteps: [],
        missingInformation: [],
        suggestions: ['Purpose of the certificate', 'Preferred language'],
        draft: {
          departmentId: 2,
          summary: 'Employment certificate',
          description: 'I need an employment certificate from HR.',
        },
      },
      ALLOWED,
      'I need an employment certificate from HR.',
    );

    expect(result.draft).toEqual({
      departmentId: 2,
      summary: 'Employment certificate',
      description: 'I need an employment certificate from HR.',
    });
    expect(result.missingInformation).toEqual([]);
    expect(result.suggestions).toEqual([
      'Purpose of the certificate',
      'Preferred language',
    ]);
    expect(isActionableIntakeDraft(result.draft)).toBe(true);
  });

  it('keeps required missing information separate from optional suggestions', () => {
    const result = validateIntakeResult(
      {
        situation: 'need',
        troubleshootingSteps: [],
        missingInformation: ['Which dates the certificate should cover'],
        suggestions: ['Preferred language'],
        draft: {
          departmentId: 2,
          summary: 'Employment certificate',
          description: 'I need an employment certificate.',
        },
      },
      ALLOWED,
      'I need an employment certificate.',
    );

    expect(result.draft?.departmentId).toBe(2);
    expect(result.missingInformation).toEqual(['Which dates the certificate should cover']);
    expect(result.suggestions).toEqual(['Preferred language']);
  });

  it('discards an invented complete draft for thin employee text', () => {
    const result = validateIntakeResult(
      {
        situation: 'need',
        troubleshootingSteps: ['Restart the computer'],
        missingInformation: [],
        draft: {
          departmentId: 1,
          summary: 'Help request',
          description: 'I need help.',
        },
      },
      ALLOWED,
      'I need help.',
    );

    expect(result.draft).toBeNull();
    expect(result.troubleshootingSteps).toEqual([]);
    expect(result.missingInformation.length).toBeGreaterThan(0);
    expect(isActionableIntakeDraft(result.draft)).toBe(false);
  });

  it('treats "I need help" as insufficient and "I need a laptop" as enough to draft', () => {
    expect(isInsufficientEmployeeText('I need help.')).toBe(true);
    expect(isInsufficientEmployeeText('I need a laptop.')).toBe(false);
    expect(
      isActionableIntakeDraft({
        departmentId: 1,
        summary: 'Laptop request',
        description: 'I need a laptop.',
      }),
    ).toBe(true);
  });

  it('rejects unexpected provider fields such as status', () => {
    expect(() =>
      validateIntakeResult(
        {
          situation: 'need',
          draft: { departmentId: 999 },
          status: 'COMPLETED',
        },
        ALLOWED,
      ),
    ).toThrow(InvalidAiOutputError);
  });
});
