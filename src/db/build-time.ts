import 'server-only';

/**
 * ⭐ A BUILD MUST NOT REQUIRE A REACHABLE, MIGRATED DATABASE.
 *
 * `generateStaticParams` runs at build time and reads the catalog. Left
 * unguarded, that makes `next build` fail outright whenever the database is
 * unreachable, empty, or a migration behind, and it fails in the least
 * helpful possible way:
 *
 *     [cause]: error: relation "category" does not exist
 *     > Build error occurred
 *     Error: Failed to collect page data for /[locale]/shop/[category]
 *
 * That is a DEPLOYMENT OUTAGE caused by the state of a database, on a build
 * that would otherwise have produced a perfectly correct application. It also
 * broke CI, whose canary build deliberately uses an invalid connection string
 * so that no real credential is present while scanning the output for leaks.
 *
 * ══ WHY EMPTY IS THE RIGHT ANSWER, NOT A FALLBACK LIST ════════════════════
 *
 * Returning `[]` does NOT mean those pages stop existing. `dynamicParams`
 * defaults to true, so every path still renders on demand at request time and
 * is then cached by the route's own `revalidate`. The only thing lost is
 * pre-warming at build, which costs one slow first request per page.
 *
 * Prerendering is an optimisation. Treating it as a build requirement couples
 * "can we ship code" to "is the database up", and those should never be the
 * same question.
 *
 * ⚠ IT IS LOUD ON PURPOSE. A silent empty result would hide a genuinely
 * misconfigured production build, so the reason is printed once per call site
 * and the build log says plainly what was skipped and why.
 */
export async function staticParamsOr<T>(
  what: string,
  read: () => Promise<readonly T[]>,
): Promise<T[]> {
  try {
    return [...(await read())];
  } catch (error) {
    const reason = error instanceof Error ? error.message.split('\n')[0] : String(error);
    console.warn(
      `[build] Could not read ${what} to prerender its pages, so none were prerendered. ` +
        `They will render on demand instead, which is correct but slower on first hit. ` +
        `Reason: ${reason}`,
    );
    return [];
  }
}
