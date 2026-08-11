import { describe, expect, it } from 'vitest';

import { postgresTls } from '@/db/ssl';

/**
 * The TLS decision is the one setting in this repository where being wrong in
 * the convenient direction sends customer names, addresses and phone numbers
 * across the internet in the clear. It used to be unconditional — correct for
 * the hosted database, and impossible for the local Postgres the integration
 * and concurrency suites need — so it is now a decision, and a decision needs
 * tests that pin which way it falls.
 *
 * The invariant these enforce: **plaintext only for loopback.** Everything
 * else, including anything unrecognised, gets the pinned CA.
 */

const SUPABASE = 'postgresql://u:p@aws-0-ca-central-1.pooler.supabase.com:6543/postgres';

describe('postgresTls', () => {
  describe('encrypts and verifies anything that is not local', () => {
    it.each([
      ['the transaction pooler', SUPABASE],
      ['the session pooler', SUPABASE.replace('6543', '5432')],
      ['some other remote host', 'postgresql://u:p@db.example.com:5432/postgres'],
      // A private address is still reachable across a network somebody else
      // may be on. "Not the public internet" is not the same as "not a
      // network".
      ['a LAN address', 'postgresql://u:p@192.168.1.50:5432/postgres'],
      ['a docker service name', 'postgresql://u:p@postgres:5432/postgres'],
    ])('%s', (_label, url) => {
      const tls = postgresTls(url);
      expect(tls).not.toBe(false);
      expect(tls).toMatchObject({ rejectUnauthorized: true });
      expect((tls as { ca: string }).ca).toContain('BEGIN CERTIFICATE');
    });

    it('falls towards encryption on a string it cannot parse', () => {
      // libpq key=value form, or simply a mangled one. An unreadable string is
      // not evidence of a local database, so it must not be treated as one.
      expect(postgresTls('host=somewhere dbname=postgres')).not.toBe(false);
    });
  });

  describe('allows plaintext for loopback, which is what unblocks the test suites', () => {
    it.each([
      ['localhost', 'postgresql://postgres:pw@localhost:5432/postgres'],
      ['127.0.0.1', 'postgresql://postgres:pw@127.0.0.1:5433/postgres'],
      ['IPv6 loopback', 'postgresql://postgres:pw@[::1]:5432/postgres'],
      ['uppercase host', 'postgresql://postgres:pw@LOCALHOST:5432/postgres'],
    ])('%s', (_label, url) => {
      expect(postgresTls(url)).toBe(false);
    });
  });

  describe('sslmode=disable', () => {
    it('is honoured for a non-hosted database', () => {
      expect(postgresTls('postgresql://u:p@db.example.com:5432/postgres?sslmode=disable')).toBe(
        false,
      );
    });

    it('is REFUSED against the hosted database, loudly', () => {
      // The scenario: someone pastes the production string into a local config
      // and appends sslmode=disable to make an error go away. Failing at the
      // moment it is written is the whole point — a silent plaintext
      // connection to production would look identical to a working one.
      expect(() => postgresTls(`${SUPABASE}?sslmode=disable`)).toThrow(/Refusing sslmode=disable/);
    });
  });
});
