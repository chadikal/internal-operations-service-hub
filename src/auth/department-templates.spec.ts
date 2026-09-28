import { INestApplication } from '@nestjs/common';
import { ApprovalPolicy } from '@prisma/client';
import * as request from 'supertest';
import { EmailSender } from './email-sender';
import { LoginRateLimiter } from './login-rate-limit';
import { PrismaService } from '../prisma/prisma.service';
import {
  cleanRequestData,
  closeTestApp,
  createTestApp,
  createTestRequestType,
  removeNonDevelopmentCompanies,
  TEST_ORIGIN,
} from '../requests/test-helpers';
import { DEPARTMENT_TEMPLATE_IDS, DEPARTMENT_TEMPLATES, listDepartmentTemplates } from './department-templates';

jest.setTimeout(60_000);

const PASSWORD = 'founder-password-not-for-production';

function authCookie(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers['set-cookie'];
  const header = Array.isArray(raw) ? raw.join(';') : String(raw ?? '');
  const match = /hub_session=([^;]+)/.exec(header);
  if (!match) {
    throw new Error('Login did not set a session cookie');
  }
  return `hub_session=${match[1]}`;
}

async function loginHeaders(app: INestApplication, email: string, password: string) {
  const response = await request(app.getHttpServer())
    .post('/auth/login')
    .set('Origin', TEST_ORIGIN)
    .send({ email, password });
  if (response.status !== 200) {
    throw new Error(`Login failed for ${email}: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return {
    Cookie: authCookie(response),
    'X-CSRF-Token': response.body.csrfToken as string,
  };
}

async function outboxToken(app: INestApplication, email: string, purpose: string): Promise<string> {
  const message = [...app.get(EmailSender).list()]
    .reverse()
    .find((item) => item.to === email && item.purpose === purpose);
  if (!message) {
    throw new Error(`No ${purpose} message for ${email}`);
  }
  return message.token;
}

async function signupAndVerify(
  app: INestApplication,
  input: { companyName: string; name: string; email: string },
) {
  const created = await request(app.getHttpServer())
    .post('/auth/signup')
    .set('Origin', TEST_ORIGIN)
    .send({ ...input, password: PASSWORD });
  if (created.status !== 201) {
    throw new Error(`Signup failed: ${created.status} ${JSON.stringify(created.body)}`);
  }
  const token = await outboxToken(app, input.email, 'email-verification');
  const verified = await request(app.getHttpServer())
    .post('/auth/verify-email')
    .set('Origin', TEST_ORIGIN)
    .send({ token });
  if (verified.status !== 200) {
    throw new Error(`Verify failed: ${verified.status} ${JSON.stringify(verified.body)}`);
  }
  return loginHeaders(app, input.email, PASSWORD);
}

async function departmentByName(
  app: INestApplication,
  headers: Record<string, string>,
  name: string,
) {
  const listed = await request(app.getHttpServer()).get('/departments').set(headers);
  return (listed.body as Array<{ id: number; name: string }>).find((row) => row.name === name);
}

describe('department templates', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  beforeEach(async () => {
    app.get(LoginRateLimiter).reset();
    await cleanRequestData(prisma);
    const extras = await prisma.employee.findMany({
      where: { id: { notIn: [1, 2] } },
      select: { id: true },
    });
    const ids = extras.map((employee) => employee.id);
    if (ids.length > 0) {
      await prisma.passwordReset.deleteMany({ where: { accountId: { in: ids } } });
      await prisma.emailVerification.deleteMany({ where: { accountId: { in: ids } } });
      await prisma.invitation.deleteMany({
        where: { OR: [{ accountId: { in: ids } }, { invitedById: { in: ids } }] },
      });
      await prisma.session.deleteMany({ where: { accountId: { in: ids } } });
      await prisma.employee.deleteMany({ where: { id: { in: ids } } });
    }
    await removeNonDevelopmentCompanies(prisma);
  });

  afterAll(async () => {
    await cleanRequestData(prisma);
    await removeNonDevelopmentCompanies(prisma);
    await closeTestApp(app);
  });

  it('records recommended types for every template and none for Custom/Empty', () => {
    expect(DEPARTMENT_TEMPLATE_IDS).toEqual([
      'IT',
      'HR',
      'FINANCE',
      'OPERATIONS',
      'MARKETING',
      'FACILITIES',
      'CUSTOM_EMPTY',
    ]);
    expect(DEPARTMENT_TEMPLATES.CUSTOM_EMPTY.suggestions).toEqual([]);
    expect(DEPARTMENT_TEMPLATES.CUSTOM_EMPTY.suggestionsRecorded).toBe(true);
    expect(DEPARTMENT_TEMPLATES.FINANCE.suggestions).toEqual([
      { name: 'Expense', approvalPolicy: 'DEPARTMENT_ADMIN' },
      { name: 'Purchase exception', approvalPolicy: 'SUPER_ADMIN' },
    ]);
    expect(DEPARTMENT_TEMPLATES.OPERATIONS.suggestions).toEqual([
      { name: 'Process change', approvalPolicy: 'DEPARTMENT_ADMIN' },
      { name: 'Operational support', approvalPolicy: 'NONE' },
    ]);
    expect(DEPARTMENT_TEMPLATES.FACILITIES.suggestions).toEqual([
      { name: 'Maintenance / Repair', approvalPolicy: 'NONE' },
      { name: 'Access badge', approvalPolicy: 'DEPARTMENT_ADMIN' },
    ]);
    for (const template of listDepartmentTemplates()) {
      expect(template.suggestionsRecorded).toBe(true);
      if (template.id !== 'CUSTOM_EMPTY') {
        expect(template.suggestions.length).toBeGreaterThan(0);
      }
    }
  });

  it('previews each recorded template including IT, HR, and Finance', async () => {
    const headers = await signupAndVerify(app, {
      companyName: 'Preview Co',
      name: 'Founder',
      email: 'preview.templates@operations-hub.test',
    });

    const listed = await request(app.getHttpServer()).get('/department-templates').set(headers);
    expect(listed.status).toBe(200);
    expect(listed.body.map((row: { id: string }) => row.id)).toEqual([...DEPARTMENT_TEMPLATE_IDS]);

    for (const template of listDepartmentTemplates()) {
      const preview = await request(app.getHttpServer())
        .get(`/department-templates/${template.id}`)
        .set(headers);
      expect(preview.status).toBe(200);
      expect(preview.body).toMatchObject({
        id: template.id,
        name: template.name,
        suggestions: template.suggestions,
        suggestionsRecorded: true,
        unspecifiedNotice: null,
      });
    }

    const unknown = await request(app.getHttpServer())
      .get('/department-templates/NOT_A_TEMPLATE')
      .set(headers);
    expect(unknown.status).toBe(404);
  });

  it('applies each template’s recorded suggestions to a new department and rejects a duplicate apply', async () => {
    const headers = await signupAndVerify(app, {
      companyName: 'Apply Each Co',
      name: 'Founder',
      email: 'apply.each.templates@operations-hub.test',
    });

    for (const template of listDepartmentTemplates()) {
      const created = await request(app.getHttpServer()).post('/departments').set(headers).send({
        name: `Desk ${template.id}`,
        templateId: template.id,
        requestTypes: template.suggestions,
      });
      expect(created.status).toBe(201);
      expect(created.body.name).toBe(`Desk ${template.id}`);
      expect(
        created.body.requestTypes.map((row: { name: string; approvalPolicy: string }) => ({
          name: row.name,
          approvalPolicy: row.approvalPolicy,
        })),
      ).toEqual(template.suggestions);

      if (template.suggestions.length === 0) {
        continue;
      }
      const duplicate = await request(app.getHttpServer())
        .post(`/departments/${created.body.id}/template-types`)
        .set(headers)
        .send({
          templateId: template.id,
          requestTypes: template.suggestions,
        });
      expect(duplicate.status).toBe(409);
      expect(duplicate.body.message).toBe(
        `A request type named "${template.suggestions[0]!.name}" already exists in this department`,
      );
      const remaining = await prisma.requestType.findMany({
        where: { departmentId: created.body.id },
        orderBy: { id: 'asc' },
      });
      expect(remaining.map((row) => ({ name: row.name, approvalPolicy: row.approvalPolicy }))).toEqual(
        template.suggestions,
      );
    }
  });

  it('creates Custom/Empty with no types and keeps the entered name independent of the template', async () => {
    const headers = await signupAndVerify(app, {
      companyName: 'Empty Create Co',
      name: 'Founder',
      email: 'empty.templates@operations-hub.test',
    });

    const created = await request(app.getHttpServer()).post('/departments').set(headers).send({
      name: 'Night Shift',
      templateId: 'CUSTOM_EMPTY',
      requestTypes: [],
    });
    expect(created.status).toBe(201);
    expect(created.body.name).toBe('Night Shift');
    expect(created.body.requestTypes).toEqual([]);

    const types = await request(app.getHttpServer()).get('/request-types').set(headers);
    expect(types.body.filter((row: { departmentId: number }) => row.departmentId === created.body.id)).toEqual(
      [],
    );

    const it = await departmentByName(app, headers, 'IT');
    const hr = await departmentByName(app, headers, 'HR');
    const finance = await departmentByName(app, headers, 'Finance');
    expect(it && hr && finance).toBeTruthy();
    const signupTypes = types.body.filter((row: { departmentId: number }) =>
      [it!.id, hr!.id, finance!.id].includes(row.departmentId),
    );
    expect(signupTypes).toEqual([]);
  });

  it('applies only the Super Admin’s edited suggestions in one transaction with the department', async () => {
    const headers = await signupAndVerify(app, {
      companyName: 'Edited Co',
      name: 'Founder',
      email: 'edited.templates@operations-hub.test',
    });

    const created = await request(app.getHttpServer()).post('/departments').set(headers).send({
      name: 'Field Ops',
      templateId: 'OPERATIONS',
      requestTypes: [{ name: 'Access', approvalPolicy: 'DEPARTMENT_ADMIN' }],
    });
    expect(created.status).toBe(201);
    expect(created.body.name).toBe('Field Ops');
    expect(created.body.requestTypes).toEqual([
      expect.objectContaining({
        departmentId: created.body.id,
        name: 'Access',
        approvalPolicy: 'DEPARTMENT_ADMIN',
      }),
    ]);

    const stored = await prisma.requestType.findMany({
      where: { departmentId: created.body.id },
    });
    expect(stored).toHaveLength(1);
    expect(stored[0]?.name).toBe('Access');
    expect(stored[0]?.approvalPolicy).toBe(ApprovalPolicy.DEPARTMENT_ADMIN);
  });

  it('rolls back the department when confirmed type names collide', async () => {
    const headers = await signupAndVerify(app, {
      companyName: 'Rollback Co',
      name: 'Founder',
      email: 'rollback.templates@operations-hub.test',
    });

    const created = await request(app.getHttpServer()).post('/departments').set(headers).send({
      name: 'Broken Desk',
      templateId: 'MARKETING',
      requestTypes: [
        { name: 'Campaign', approvalPolicy: 'NONE' },
        { name: 'campaign', approvalPolicy: 'SUPER_ADMIN' },
      ],
    });
    expect(created.status).toBe(409);
    expect(created.body.message).toBe('Confirmed request types must not use the same name more than once');
    expect(await prisma.department.findFirst({ where: { name: 'Broken Desk' } })).toBeNull();
    expect(await prisma.requestType.count({ where: { name: { in: ['Campaign', 'campaign'] } } })).toBe(0);
  });

  it('keeps existing types and submitted requests when applying to a department, including signup defaults', async () => {
    const headers = await signupAndVerify(app, {
      companyName: 'Apply Co',
      name: 'Founder',
      email: 'apply.templates@operations-hub.test',
    });
    const it = await departmentByName(app, headers, 'IT');
    const maintenance = await request(app.getHttpServer()).post('/departments').set(headers).send({
      name: 'Maintenance',
    });
    expect(maintenance.status).toBe(201);
    expect(maintenance.body.requestTypes).toEqual([]);

    const existing = await createTestRequestType(app, headers, it!.id, 'General', 'NONE');
    const founder = await prisma.employee.findUniqueOrThrow({
      where: { email: 'apply.templates@operations-hub.test' },
    });
    const submitted = await request(app.getHttpServer()).post('/requests').set(headers).send({
      submittedBy: founder.id,
      departmentId: it!.id,
      requestTypeId: existing.id,
      title: 'Keep this request',
    });
    expect(submitted.status).toBe(201);

    const applied = await request(app.getHttpServer())
      .post(`/departments/${it!.id}/template-types`)
      .set(headers)
      .send({
        templateId: 'IT',
        requestTypes: DEPARTMENT_TEMPLATES.IT.suggestions,
      });
    expect(applied.status).toBe(201);
    expect(applied.body.name).toBe('IT');
    expect(applied.body.requestTypes.map((row: { name: string }) => row.name).sort()).toEqual(
      ['Access', 'General', 'Hardware', 'Software'].sort(),
    );

    const storedRequest = await prisma.request.findUniqueOrThrow({ where: { id: submitted.body.id } });
    expect(storedRequest.requestTypeId).toBe(existing.id);
    expect(storedRequest.capturedApprovalPolicy).toBe(ApprovalPolicy.NONE);
    expect(storedRequest.title).toBe('Keep this request');

    const hr = await departmentByName(app, headers, 'HR');
    const finance = await departmentByName(app, headers, 'Finance');
    const hrApplied = await request(app.getHttpServer())
      .post(`/departments/${hr!.id}/template-types`)
      .set(headers)
      .send({
        templateId: 'HR',
        requestTypes: DEPARTMENT_TEMPLATES.HR.suggestions,
      });
    expect(hrApplied.status).toBe(201);
    expect(hrApplied.body.name).toBe('HR');
    const financeApplied = await request(app.getHttpServer())
      .post(`/departments/${finance!.id}/template-types`)
      .set(headers)
      .send({
        templateId: 'FINANCE',
        requestTypes: DEPARTMENT_TEMPLATES.FINANCE.suggestions,
      });
    expect(financeApplied.status).toBe(201);
    expect(financeApplied.body.name).toBe('Finance');

    const facilities = await request(app.getHttpServer())
      .post(`/departments/${maintenance.body.id}/template-types`)
      .set(headers)
      .send({
        templateId: 'FACILITIES',
        requestTypes: [{ name: 'Maintenance / Repair', approvalPolicy: 'NONE' }],
      });
    expect(facilities.status).toBe(201);
    expect(facilities.body.requestTypes).toEqual([
      expect.objectContaining({ name: 'Maintenance / Repair', approvalPolicy: 'NONE' }),
    ]);
    expect(await prisma.department.findUniqueOrThrow({ where: { id: maintenance.body.id } })).toMatchObject({
      name: 'Maintenance',
    });
  });

  it('rolls back newly inserted types when a later confirmed name already exists', async () => {
    const headers = await signupAndVerify(app, {
      companyName: 'Apply Rollback Co',
      name: 'Founder',
      email: 'apply.rollback@operations-hub.test',
    });
    const it = await departmentByName(app, headers, 'IT');
    const existing = await createTestRequestType(app, headers, it!.id, 'General', 'NONE');

    const applied = await request(app.getHttpServer())
      .post(`/departments/${it!.id}/template-types`)
      .set(headers)
      .send({
        templateId: 'OPERATIONS',
        requestTypes: [
          { name: 'Laptop', approvalPolicy: 'NONE' },
          { name: 'general', approvalPolicy: 'SUPER_ADMIN' },
        ],
      });
    expect(applied.status).toBe(409);
    expect(applied.body.message).toBe('A request type named "General" already exists in this department');
    const remaining = await prisma.requestType.findMany({ where: { departmentId: it!.id } });
    expect(remaining).toEqual([expect.objectContaining({ id: existing.id, name: 'General' })]);
    expect(remaining.some((row) => row.name === 'Laptop')).toBe(false);
  });

  it('does not infer a template from the department name and keeps companies isolated', async () => {
    const headersA = await signupAndVerify(app, {
      companyName: 'Iso A',
      name: 'Founder A',
      email: 'iso.a.templates@operations-hub.test',
    });
    const headersB = await signupAndVerify(app, {
      companyName: 'Iso B',
      name: 'Founder B',
      email: 'iso.b.templates@operations-hub.test',
    });

    const maintenance = await request(app.getHttpServer()).post('/departments').set(headersA).send({
      name: 'Maintenance',
    });
    expect(maintenance.status).toBe(201);
    expect(maintenance.body.requestTypes).toEqual([]);
    const typesA = await request(app.getHttpServer()).get('/request-types').set(headersA);
    expect(typesA.body.filter((row: { departmentId: number }) => row.departmentId === maintenance.body.id)).toEqual(
      [],
    );

    const steal = await request(app.getHttpServer())
      .post(`/departments/${maintenance.body.id}/template-types`)
      .set(headersB)
      .send({
        templateId: 'FACILITIES',
        requestTypes: [{ name: 'Maintenance / Repair', approvalPolicy: 'NONE' }],
      });
    expect(steal.status).toBe(404);
    expect(
      await prisma.requestType.count({
        where: { departmentId: maintenance.body.id },
      }),
    ).toBe(0);

    const createdB = await request(app.getHttpServer()).post('/departments').set(headersB).send({
      name: 'Field Ops',
      templateId: 'OPERATIONS',
      requestTypes: [{ name: 'Access', approvalPolicy: 'NONE' }],
    });
    expect(createdB.status).toBe(201);
    const listedA = await request(app.getHttpServer()).get('/request-types').set(headersA);
    expect(listedA.body.map((row: { id: number }) => row.id)).not.toContain(createdB.body.requestTypes[0].id);
  });

  it('does not let staff preview templates or apply suggested types', async () => {
    const headers = await signupAndVerify(app, {
      companyName: 'Staff Template Co',
      name: 'Founder',
      email: 'staff.templates@operations-hub.test',
    });
    const it = await departmentByName(app, headers, 'IT');
    const invited = await request(app.getHttpServer()).post('/auth/invitations').set(headers).send({
      email: 'staff.template.user@operations-hub.test',
      name: 'Template Staff',
      departmentId: it!.id,
      role: 'EMPLOYEE',
      canHandle: false,
    });
    expect(invited.status).toBe(201);
    const inviteToken = await outboxToken(app, 'staff.template.user@operations-hub.test', 'invitation');
    expect(
      (
        await request(app.getHttpServer())
          .post('/auth/invitations/accept')
          .set('Origin', TEST_ORIGIN)
          .send({ token: inviteToken, password: PASSWORD })
      ).status,
    ).toBe(200);
    const staffHeaders = await loginHeaders(app, 'staff.template.user@operations-hub.test', PASSWORD);

    const listed = await request(app.getHttpServer()).get('/department-templates').set(staffHeaders);
    expect(listed.status).toBe(403);
    const preview = await request(app.getHttpServer())
      .get('/department-templates/CUSTOM_EMPTY')
      .set(staffHeaders);
    expect(preview.status).toBe(403);
    const apply = await request(app.getHttpServer())
      .post(`/departments/${it!.id}/template-types`)
      .set(staffHeaders)
      .send({ templateId: 'OPERATIONS', requestTypes: [] });
    expect(apply.status).toBe(403);
  });
});
