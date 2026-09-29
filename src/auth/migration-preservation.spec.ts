import { readFileSync } from 'fs';
import { join } from 'path';
import pg = require('pg');

const ISOLATED_DATABASE = 'operations_hub_auth_migration';
const FORBIDDEN_DATABASES = new Set(['operations_hub', 'operations_hub_test']);

const PRESERVED_AT = new Date('2024-06-01T08:30:00.000Z');

const PRE_AUTH_MIGRATIONS = [
  'prisma/migrations/20260910100215_init/migration.sql',
  'prisma/migrations/20260910123252_add_employee_can_handle/migration.sql',
  'prisma/migrations/20260919095918_add_request_title_description/migration.sql',
];
const AUTH_MIGRATION = 'prisma/migrations/20260922160000_add_authentication/migration.sql';
const COMPANY_MIGRATION = 'prisma/migrations/20260924150000_add_company_boundary/migration.sql';
const REQUEST_TYPES_MIGRATION = 'prisma/migrations/20260925233000_add_request_types/migration.sql';
const APPROVAL_MIGRATION = 'prisma/migrations/20260926140000_add_approval_decisions/migration.sql';
const MIGRATIONS_BEFORE_COMPANY = [...PRE_AUTH_MIGRATIONS, AUTH_MIGRATION];
const MIGRATIONS_FROM_COMPANY = [
  COMPANY_MIGRATION,
  REQUEST_TYPES_MIGRATION,
  APPROVAL_MIGRATION,
  'prisma/migrations/20260926170000_add_request_submitted_at/migration.sql',
  'prisma/migrations/20260927003000_add_password_reset/migration.sql',
  'prisma/migrations/20260928170000_add_request_claimed_at/migration.sql',
  'prisma/migrations/20260929133000_remove_empty_development_company/migration.sql',
];

type SqlRunner = {
  query: (queryText: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;
  end: () => Promise<void>;
  connect?: () => Promise<unknown>;
};

function assertIsolatedDatabase(name: string): void {
  if (FORBIDDEN_DATABASES.has(name) || name !== ISOLATED_DATABASE) {
    throw new Error(`Refusing to create or drop database "${name}".`);
  }
}

function databaseUrlFor(databaseUrl: string, name: string): string {
  assertIsolatedDatabase(name);
  const url = new URL(databaseUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

function requireTestSourceUrl(): string {
  const sourceUrl = process.env.DATABASE_URL;
  if (!sourceUrl) {
    throw new Error('DATABASE_URL is required.');
  }
  const sourceName = decodeURIComponent(new URL(sourceUrl).pathname.replace(/^\/+/, ''));
  if (sourceName !== 'operations_hub_test') {
    throw new Error(`Refusing to derive an isolated database from "${sourceName}".`);
  }
  return sourceUrl;
}

function isDuplicateDatabaseError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  if ('code' in error && (error as { code?: unknown }).code === '42P04') {
    return true;
  }
  return error instanceof Error && /already exists/i.test(error.message);
}

async function createScratchDatabase(admin: SqlRunner, name: string): Promise<void> {
  assertIsolatedDatabase(name);
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
  } catch (error) {
    if (isDuplicateDatabaseError(error)) {
      throw new Error(
        `Database "${name}" already exists. Refusing to terminate its connections or drop it.`,
      );
    }
    throw error;
  }
}

async function dropScratchDatabase(admin: SqlRunner, name: string): Promise<void> {
  assertIsolatedDatabase(name);
  await admin.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [name],
  );
  await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
}

async function withScratchDatabase<T>(
  admin: SqlRunner,
  connectScratch: () => Promise<SqlRunner>,
  body: (scratch: SqlRunner) => Promise<T>,
): Promise<T> {
  let createdByThisRun = false;
  let scratch: SqlRunner | undefined;
  let bodyError: unknown;
  let result: T | undefined;
  const cleanupErrors: unknown[] = [];
  try {
    if (admin.connect) {
      await admin.connect();
    }
    await createScratchDatabase(admin, ISOLATED_DATABASE);
    createdByThisRun = true;
    scratch = await connectScratch();
    result = await body(scratch);
  } catch (error) {
    bodyError = error;
  } finally {
    if (scratch) {
      try {
        await scratch.end();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (createdByThisRun) {
      try {
        await dropScratchDatabase(admin, ISOLATED_DATABASE);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    try {
      await admin.end();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (bodyError) {
    throw bodyError;
  }
  if (cleanupErrors.length > 0) {
    throw cleanupErrors[0];
  }
  return result as T;
}

async function connectAllocatedClient<T extends { connect: () => Promise<unknown>; end: () => Promise<void> }>(
  client: T,
): Promise<T> {
  try {
    await client.connect();
    return client;
  } catch (error) {
    try {
      await client.end();
    } catch {
      // end() can fail after a refused connection. The connection error is the one to report.
    }
    throw error;
  }
}

function connectScratchClient(connectionString: string): Promise<pg.Client> {
  return connectAllocatedClient(new pg.Client({ connectionString }));
}

async function queryFile(client: SqlRunner, relativePath: string): Promise<void> {
  const sql = readFileSync(join(process.cwd(), relativePath), 'utf8');
  await client.query(sql);
}

function duplicateDatabaseError(): Error & { code: string } {
  const error = new Error(`database "${ISOLATED_DATABASE}" already exists`) as Error & { code: string };
  error.code = '42P04';
  return error;
}

describe('authentication migration preservation', () => {
  jest.setTimeout(60_000);

  it('refuses to create or drop the development and test databases', async () => {
    const queries: string[] = [];
    const admin: SqlRunner = {
      query: async (queryText) => {
        queries.push(queryText);
        return { rows: [] };
      },
      end: async () => undefined,
    };
    await expect(createScratchDatabase(admin, 'operations_hub')).rejects.toThrow(/Refusing to create or drop/);
    await expect(createScratchDatabase(admin, 'operations_hub_test')).rejects.toThrow(/Refusing to create or drop/);
    await expect(dropScratchDatabase(admin, 'operations_hub')).rejects.toThrow(/Refusing to create or drop/);
    await expect(dropScratchDatabase(admin, 'operations_hub_test')).rejects.toThrow(/Refusing to create or drop/);
    expect(queries).toEqual([]);
  });

  it('leaves an existing database untouched and does not delete after a failed create', async () => {
    const existingEvents: string[] = [];
    const existingAdmin: SqlRunner = {
      query: async (queryText) => {
        existingEvents.push(queryText);
        throw duplicateDatabaseError();
      },
      end: async () => {
        existingEvents.push('admin.end');
      },
    };
    await expect(
      withScratchDatabase(
        existingAdmin,
        async () => {
          existingEvents.push('scratch.connect');
          return {
            query: async () => ({ rows: [] }),
            end: async () => {
              existingEvents.push('scratch.end');
            },
          };
        },
        async () => {
          existingEvents.push('body');
          return undefined;
        },
      ),
    ).rejects.toThrow(/already exists/);
    expect(existingEvents).toEqual([`CREATE DATABASE "${ISOLATED_DATABASE}"`, 'admin.end']);

    const failedEvents: string[] = [];
    const failedAdmin: SqlRunner = {
      query: async (queryText) => {
        failedEvents.push(queryText);
        throw Object.assign(new Error('permission denied to create database'), { code: '42501' });
      },
      end: async () => {
        failedEvents.push('admin.end');
      },
    };
    await expect(
      withScratchDatabase(
        failedAdmin,
        async () => {
          throw new Error('scratch must not be opened');
        },
        async () => undefined,
      ),
    ).rejects.toThrow(/permission denied to create database/);
    expect(failedEvents.some((event) => /DROP DATABASE|pg_terminate_backend/.test(event))).toBe(false);
    expect(failedEvents).toEqual([`CREATE DATABASE "${ISOLATED_DATABASE}"`, 'admin.end']);
  });

  it('closes both clients when cleanup fails', async () => {
    const events: string[] = [];
    const admin: SqlRunner = {
      query: async (queryText) => {
        events.push(queryText);
        if (queryText.startsWith('DROP DATABASE')) {
          throw new Error('drop failed');
        }
        return { rows: [] };
      },
      end: async () => {
        events.push('admin.end');
      },
    };
    await expect(
      withScratchDatabase(
        admin,
        async () => ({
          query: async () => ({ rows: [] }),
          end: async () => {
            events.push('scratch.end');
          },
        }),
        async () => undefined,
      ),
    ).rejects.toThrow(/drop failed/);
    expect(events).toContain('scratch.end');
    expect(events).toContain('admin.end');
    expect(events.indexOf('scratch.end')).toBeLessThan(events.indexOf('admin.end'));
  });

  it('closes a scratch client whose connection fails and drops only a database this run created', async () => {
    const connectionError = new Error('scratch connect failed');
    const createdEvents: string[] = [];
    const createdAdmin: SqlRunner = {
      query: async (queryText) => {
        createdEvents.push(queryText);
        return { rows: [] };
      },
      end: async () => {
        createdEvents.push('admin.end');
      },
    };
    const createdScratch = {
      connect: async () => {
        createdEvents.push('scratch.connect');
        throw connectionError;
      },
      query: async () => ({ rows: [] }),
      end: async () => {
        createdEvents.push('scratch.end');
        throw new Error('end failed after refused connection');
      },
    };
    await expect(
      withScratchDatabase(createdAdmin, () => connectAllocatedClient(createdScratch), async () => undefined),
    ).rejects.toBe(connectionError);
    expect(createdEvents).toContain('scratch.end');
    expect(createdEvents).toContain('admin.end');
    expect(createdEvents.some((event) => event.startsWith('DROP DATABASE'))).toBe(true);

    const refusedEvents: string[] = [];
    const refusedAdmin: SqlRunner = {
      query: async (queryText) => {
        refusedEvents.push(queryText);
        throw duplicateDatabaseError();
      },
      end: async () => {
        refusedEvents.push('admin.end');
      },
    };
    const refusedScratch = {
      connect: async () => {
        refusedEvents.push('scratch.connect');
        throw connectionError;
      },
      query: async () => ({ rows: [] }),
      end: async () => {
        refusedEvents.push('scratch.end');
      },
    };
    await expect(
      withScratchDatabase(refusedAdmin, () => connectAllocatedClient(refusedScratch), async () => undefined),
    ).rejects.toThrow(/already exists/);
    expect(refusedEvents).not.toContain('scratch.connect');
    expect(refusedEvents).not.toContain('scratch.end');
    expect(refusedEvents.some((event) => /DROP DATABASE|pg_terminate_backend/.test(event))).toBe(false);
    expect(refusedEvents).toContain('admin.end');
  });

  it('keeps a pre-existing scratch database and its rows when create finds it', async () => {
    const sourceUrl = requireTestSourceUrl();
    const admin = new pg.Client({ connectionString: sourceUrl });
    await withScratchDatabase(
      admin,
      () => connectScratchClient(databaseUrlFor(sourceUrl, ISOLATED_DATABASE)),
      async (scratch) => {
        await scratch.query('CREATE TABLE preserved_marker (id int)');
        await scratch.query('INSERT INTO preserved_marker (id) VALUES (7)');
        await expect(createScratchDatabase(admin, ISOLATED_DATABASE)).rejects.toThrow(/already exists/);
        const marker = await scratch.query('SELECT id FROM preserved_marker');
        expect(marker.rows).toEqual([{ id: 7 }]);
      },
    );
  });

  it('keeps employees, requests, and history that existed before the authentication migration', async () => {
    const sourceUrl = requireTestSourceUrl();
    assertIsolatedDatabase(ISOLATED_DATABASE);
    const admin = new pg.Client({ connectionString: sourceUrl });
    await withScratchDatabase(
      admin,
      () => connectScratchClient(databaseUrlFor(sourceUrl, ISOLATED_DATABASE)),
      async (scratch) => {
        for (const migration of PRE_AUTH_MIGRATIONS) {
          await queryFile(scratch, migration);
        }

        await scratch.query(`INSERT INTO "Department" (id, name) VALUES (4, 'Facilities')`);
        await scratch.query(
          `INSERT INTO "Employee" (id, name, "departmentId", "canHandle") VALUES (42, 'Preexisting Person', 4, true)`,
        );
        await scratch.query(
          `INSERT INTO "Request"
            (id, "submittedBy", "departmentId", "currentOwnerId", status, "statusUpdatedAt", title, description)
           VALUES (100, 42, 4, NULL, 'SUBMITTED', $1, 'Keep this title', 'Keep this description')`,
          [PRESERVED_AT],
        );
        await scratch.query(
          `INSERT INTO "RequestStatusHistory"
            (id, "requestId", "previousStatus", "newStatus", "changedBy", "changedAt")
           VALUES (5, 100, 'SUBMITTED', 'IN_PROGRESS', 42, $1)`,
          [PRESERVED_AT],
        );

        await queryFile(scratch, AUTH_MIGRATION);

        const employees = await scratch.query(
          `SELECT id, name, "departmentId", "canHandle", email, "passwordHash", role::text AS role, active
           FROM "Employee" ORDER BY id`,
        );
        expect(employees.rows).toEqual([
          {
            id: 42,
            name: 'Preexisting Person',
            departmentId: 4,
            canHandle: true,
            email: null,
            passwordHash: null,
            role: 'EMPLOYEE',
            active: true,
          },
        ]);

        const requests = await scratch.query(
          `SELECT id, "submittedBy", "departmentId", "currentOwnerId", status::text AS status, title, description
           FROM "Request" ORDER BY id`,
        );
        expect(requests.rows).toEqual([
          {
            id: 100,
            submittedBy: 42,
            departmentId: 4,
            currentOwnerId: null,
            status: 'SUBMITTED',
            title: 'Keep this title',
            description: 'Keep this description',
          },
        ]);

        const history = await scratch.query(
          `SELECT id, "requestId", "previousStatus"::text AS "previousStatus", "newStatus"::text AS "newStatus", "changedBy"
           FROM "RequestStatusHistory" ORDER BY id`,
        );
        expect(history.rows).toEqual([
          {
            id: 5,
            requestId: 100,
            previousStatus: 'SUBMITTED',
            newStatus: 'IN_PROGRESS',
            changedBy: 42,
          },
        ]);
      },
    );
  });

  it('keeps those rows and attaches them to one development company', async () => {
    const sourceUrl = requireTestSourceUrl();
    assertIsolatedDatabase(ISOLATED_DATABASE);
    const admin = new pg.Client({ connectionString: sourceUrl });
    await withScratchDatabase(
      admin,
      () => connectScratchClient(databaseUrlFor(sourceUrl, ISOLATED_DATABASE)),
      async (scratch) => {
        for (const migration of PRE_AUTH_MIGRATIONS) {
          await queryFile(scratch, migration);
        }
        await scratch.query(`INSERT INTO "Department" (id, name) VALUES (4, 'Facilities')`);
        await scratch.query(
          `INSERT INTO "Employee" (id, name, "departmentId", "canHandle") VALUES (42, 'Preexisting Person', 4, true)`,
        );
        await scratch.query(
          `INSERT INTO "Request"
            (id, "submittedBy", "departmentId", "currentOwnerId", status, "statusUpdatedAt", title, description)
           VALUES (100, 42, 4, NULL, 'SUBMITTED', $1, 'Keep this title', 'Keep this description')`,
          [PRESERVED_AT],
        );
        await scratch.query(
          `INSERT INTO "RequestStatusHistory"
            (id, "requestId", "previousStatus", "newStatus", "changedBy", "changedAt")
           VALUES (5, 100, 'SUBMITTED', 'IN_PROGRESS', 42, $1)`,
          [PRESERVED_AT],
        );
        await queryFile(scratch, AUTH_MIGRATION);
        await scratch.query(
          `INSERT INTO "Session" (id, "accountId", "csrfToken", "createdAt", "lastActivityAt", "absoluteExpiresAt")
           VALUES ('preserved-session', 42, 'csrf-preserved', $1, $1, $1)`,
          [PRESERVED_AT],
        );

        await queryFile(scratch, COMPANY_MIGRATION);

        const companies = await scratch.query(
          `SELECT name, status::text AS status FROM "Company" ORDER BY id`,
        );
        expect(companies.rows).toEqual([{ name: 'Development', status: 'ACTIVE' }]);
        const companyId = (
          await scratch.query(`SELECT id FROM "Company" ORDER BY id LIMIT 1`)
        ).rows[0] as { id: number };

        const employees = await scratch.query(
          `SELECT id, name, "departmentId", "canHandle", email, "passwordHash", role::text AS role, active, "companyId"
           FROM "Employee" ORDER BY id`,
        );
        expect(employees.rows).toEqual([
          {
            id: 42,
            name: 'Preexisting Person',
            departmentId: 4,
            canHandle: true,
            email: null,
            passwordHash: null,
            role: 'EMPLOYEE',
            active: true,
            companyId: companyId.id,
          },
        ]);

        const requests = await scratch.query(
          `SELECT id, "submittedBy", "departmentId", title, "companyId" FROM "Request" ORDER BY id`,
        );
        expect(requests.rows).toEqual([
          {
            id: 100,
            submittedBy: 42,
            departmentId: 4,
            title: 'Keep this title',
            companyId: companyId.id,
          },
        ]);

        const history = await scratch.query(
          `SELECT id, "requestId", "changedBy", "companyId" FROM "RequestStatusHistory" ORDER BY id`,
        );
        expect(history.rows).toEqual([
          { id: 5, requestId: 100, changedBy: 42, companyId: companyId.id },
        ]);

        const sessions = await scratch.query(
          `SELECT id, "accountId", "csrfToken", "companyId" FROM "Session"`,
        );
        expect(sessions.rows).toEqual([
          {
            id: 'preserved-session',
            accountId: 42,
            csrfToken: 'csrf-preserved',
            companyId: companyId.id,
          },
        ]);

        await queryFile(scratch, REQUEST_TYPES_MIGRATION);

        const afterTypes = await scratch.query(
          `SELECT id, title, description, "requestTypeId", "capturedApprovalPolicy"
           FROM "Request" ORDER BY id`,
        );
        expect(afterTypes.rows).toEqual([
          {
            id: 100,
            title: 'Keep this title',
            description: 'Keep this description',
            requestTypeId: null,
            capturedApprovalPolicy: null,
          },
        ]);
        const typeCount = await scratch.query(`SELECT COUNT(*)::int AS count FROM "RequestType"`);
        expect(typeCount.rows).toEqual([{ count: 0 }]);

        await queryFile(scratch, APPROVAL_MIGRATION);
        const afterApproval = await scratch.query(
          `SELECT id, title, description, "requestTypeId", "capturedApprovalPolicy", "approvalState"
           FROM "Request" ORDER BY id`,
        );
        expect(afterApproval.rows).toEqual([
          {
            id: 100,
            title: 'Keep this title',
            description: 'Keep this description',
            requestTypeId: null,
            capturedApprovalPolicy: null,
            approvalState: null,
          },
        ]);
        const decisionCount = await scratch.query(`SELECT COUNT(*)::int AS count FROM "ApprovalDecision"`);
        expect(decisionCount.rows).toEqual([{ count: 0 }]);
      },
    );
  });

  it('leaves a freshly migrated database with no bootstrap company', async () => {
    const sourceUrl = requireTestSourceUrl();
    assertIsolatedDatabase(ISOLATED_DATABASE);
    const admin = new pg.Client({ connectionString: sourceUrl });
    await withScratchDatabase(
      admin,
      () => connectScratchClient(databaseUrlFor(sourceUrl, ISOLATED_DATABASE)),
      async (scratch) => {
        for (const migration of [...MIGRATIONS_BEFORE_COMPANY, ...MIGRATIONS_FROM_COMPANY]) {
          await queryFile(scratch, migration);
        }
        const empty = await scratch.query(`SELECT COUNT(*)::int AS count FROM "Company"`);
        expect(empty.rows).toEqual([{ count: 0 }]);
      },
    );
  });

  it('keeps a Development company that already owns departments and accounts', async () => {
    const sourceUrl = requireTestSourceUrl();
    assertIsolatedDatabase(ISOLATED_DATABASE);
    const admin = new pg.Client({ connectionString: sourceUrl });
    await withScratchDatabase(
      admin,
      () => connectScratchClient(databaseUrlFor(sourceUrl, ISOLATED_DATABASE)),
      async (scratch) => {
        for (const migration of MIGRATIONS_BEFORE_COMPANY) {
          await queryFile(scratch, migration);
        }
        await scratch.query(`INSERT INTO "Department" (id, name) VALUES (4, 'Facilities')`);
        await scratch.query(
          `INSERT INTO "Employee" (id, name, "departmentId", "canHandle") VALUES (42, 'Preexisting Person', 4, true)`,
        );
        await scratch.query(
          `INSERT INTO "Request"
            (id, "submittedBy", "departmentId", "currentOwnerId", status, "statusUpdatedAt", title, description)
           VALUES (100, 42, 4, NULL, 'SUBMITTED', $1, 'Keep this title', 'Keep this description')`,
          [PRESERVED_AT],
        );
        for (const migration of MIGRATIONS_FROM_COMPANY) {
          await queryFile(scratch, migration);
        }
        const preserved = await scratch.query(
          `SELECT "Company".name, "Company".status::text AS status, "Employee".id AS "employeeId", "Employee".name AS "employeeName"
           FROM "Company"
           JOIN "Employee" ON "Employee"."companyId" = "Company".id
           ORDER BY "Employee".id`,
        );
        expect(preserved.rows).toEqual([
          {
            name: 'Development',
            status: 'ACTIVE',
            employeeId: 42,
            employeeName: 'Preexisting Person',
          },
        ]);
      },
    );
  });

  it('does not delete another Development company that has an account', async () => {
    const sourceUrl = requireTestSourceUrl();
    assertIsolatedDatabase(ISOLATED_DATABASE);
    const admin = new pg.Client({ connectionString: sourceUrl });
    const cleanup = MIGRATIONS_FROM_COMPANY[MIGRATIONS_FROM_COMPANY.length - 1];
    await withScratchDatabase(
      admin,
      () => connectScratchClient(databaseUrlFor(sourceUrl, ISOLATED_DATABASE)),
      async (scratch) => {
        for (const migration of [...MIGRATIONS_BEFORE_COMPANY, ...MIGRATIONS_FROM_COMPANY.slice(0, -1)]) {
          await queryFile(scratch, migration);
        }
        await scratch.query(
          `INSERT INTO "Company" (name, status) VALUES ('Development', 'PENDING')`,
        );
        const created = await scratch.query(
          `INSERT INTO "Company" (name, status) VALUES ('Development', 'ACTIVE') RETURNING id`,
        );
        const companyId = (created.rows[0] as { id: number }).id;
        await scratch.query(`INSERT INTO "Employee" (name, "companyId") VALUES ('Workspace Founder', $1)`, [
          companyId,
        ]);

        await queryFile(scratch, cleanup);

        const companies = await scratch.query(
          `SELECT "Company".name, "Company".status::text AS status,
                  (SELECT COUNT(*)::int FROM "Employee" WHERE "Employee"."companyId" = "Company".id) AS employees
           FROM "Company"
           ORDER BY "Company".id`,
        );
        expect(companies.rows).toEqual([
          { name: 'Development', status: 'PENDING', employees: 0 },
          { name: 'Development', status: 'ACTIVE', employees: 1 },
        ]);
      },
    );
  });
});
