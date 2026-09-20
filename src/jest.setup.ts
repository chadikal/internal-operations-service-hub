/**
 * Jest loads this file before any spec, so DATABASE_URL is forced onto
 * operations_hub_test before Nest or PrismaClient can be constructed.
 *
 * Loading happens only from .env.test. There is no fallback to .env.
 * The parsed database name must be exactly operations_hub_test.
 * AI_PROVIDER is forced to mock so tests never call Requesty.
 */
require('../scripts/load-test-env.cjs').loadTestEnv();
process.env.AI_PROVIDER = 'mock';
delete process.env.REQUESTY_API_KEY;
