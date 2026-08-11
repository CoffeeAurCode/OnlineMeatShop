/**
 * `server-only` throws by design when imported outside a React Server
 * Component graph, which is exactly what an integration test is. Aliased to
 * this in vitest.integration.config.ts.
 *
 * This does NOT weaken the guarantee it provides in the application: the alias
 * exists only in the integration test config, and the real module is still what
 * `next build` resolves. A client component importing a repository still fails
 * the build.
 */
export {};
