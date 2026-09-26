import 'dotenv/config';
import { RequestyAiProvider } from '../src/ai/requesty-ai.provider';
import { validateIntakeResult } from '../src/ai/intake.schema';

const departments = [
  { id: 1, name: 'IT' },
  { id: 2, name: 'HR' },
  { id: 3, name: 'Finance' },
];

const requestTypes = [
  { id: 11, name: 'Hardware', departmentId: 1 },
  { id: 12, name: 'Software', departmentId: 1 },
  { id: 13, name: 'Access', departmentId: 1 },
  { id: 21, name: 'Leave', departmentId: 2 },
  { id: 22, name: 'Certificate', departmentId: 2 },
];

// Closing live run on 26 Sep 2026, mistral/leanstral-1-5, one completion per case:
// clear permission -> IT Access; ambiguous VPN -> troubleshooting and no type;
// failing VPN client -> troubleshooting and no type.
// The failing-client expectation stays Software. That exact-type case failed.
const cases = [
  {
    name: 'clear access',
    text: 'I need permission to use the VPN.',
    expectTypeId: 13,
    expectSituation: 'need',
  },
  {
    name: 'clear malfunction',
    text: 'The VPN client will not connect.',
    expectTypeId: 12,
    expectSituation: 'problem',
  },
  {
    name: 'ambiguous wording',
    text: "I can't access the VPN; I need permission.",
    expectTypeId: null,
    expectSituation: 'problem',
  },
];

async function main() {
  if (!process.env.REQUESTY_API_KEY?.trim()) {
    console.log('LIVE: skipped. REQUESTY_API_KEY is empty.');
    process.exitCode = 1;
    return;
  }

  const provider = new RequestyAiProvider();
  const allowedDepartments = new Set(departments.map((department) => department.id));
  let failed = 0;

  for (const item of cases) {
    const raw = await provider.complete({
      employeeText: item.text,
      departments,
      requestTypes,
    });
    const result = validateIntakeResult(raw, allowedDepartments, item.text, requestTypes);
    const typeName =
      requestTypes.find((type) => type.id === result.draft?.requestTypeId)?.name ?? null;
    const typeId = result.draft?.requestTypeId ?? null;
    const passed =
      result.situation === item.expectSituation &&
      typeId === item.expectTypeId &&
      (item.expectTypeId !== null ||
        (result.draft?.departmentId === 1 && result.troubleshootingSteps.length > 0));
    if (!passed) {
      failed += 1;
    }
    console.log(
      JSON.stringify({
        live: true,
        case: item.name,
        passed,
        situation: result.situation,
        troubleshootingSteps: result.troubleshootingSteps.length,
        departmentId: result.draft?.departmentId ?? null,
        requestTypeId: result.draft?.requestTypeId ?? null,
        requestTypeName: typeName,
        missingInformation: result.missingInformation,
        suggestions: result.suggestions,
      }),
    );
  }

  if (failed > 0) {
    process.exitCode = 1;
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Live intake eval failed';
  console.log(JSON.stringify({ live: true, error: message }));
  process.exitCode = 1;
});
