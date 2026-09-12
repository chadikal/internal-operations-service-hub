/**
 * Jest loads this file before any spec, so DATABASE_URL is forced onto
 * operations_hub_test before Nest or PrismaClient can be constructed.
 *
 * Loading happens only from .env.test. There is no fallback to .env.
 * The parsed database name must be exactly operations_hub_test.
 */
require('../scripts/load-test-env.cjs').loadTestEnv();
