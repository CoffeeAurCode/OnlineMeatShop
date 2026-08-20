'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { BellRingingIcon, XIcon } from '@phosphor-icons/react/dist/ssr';

/**
 * ⭐ THE NEW-ORDER ALARM. A chime, then the console says out loud that an
 * order has arrived.
 *
 * The shop asked for this specifically, and the reason is the shape of the
 * business: one person, hands wet, phone on a shelf across the room. A badge
 * that increments is invisible to them. A noise is not.
 *
 * ══ WHY IT SPEAKS INSTEAD OF PLAYING A RECORDING ══════════════════════════
 *
 * `speechSynthesis` is in the browser already. The alternative — an uploaded
 * audio file — needs a storage bucket, an upload screen, a CDN URL and a
 * cache-busting story, and buys a sound the owner has to record. Speaking a
 * sentence they typed into the settings screen is editable in two taps from
 * the same phone, works offline, and costs no bytes.
 *
 * ⚠ THE CHIME IS SYNTHESISED, NOT A FILE, for the same reason and one more:
 * an `<audio src>` is a network request, and the moment this matters most is
 * the moment the connection is worst.
 *
 * ══ THE AUTOPLAY PROBLEM, WHICH IS THE WHOLE ENGINEERING PROBLEM ══════════
 *
 * ⚠ BROWSERS REFUSE TO MAKE NOISE UNTIL THE USER HAS INTERACTED WITH THE PAGE.
 * An `AudioContext` created without a gesture starts `suspended`, and
 * `speechSynthesis.speak` is silently dropped. So a console left open on a
 * tablet since 6am would ring for nobody, and — worse — would appear to work
 * in every test where a developer clicked something first.
 *
 * This is handled honestly rather than hopefully: the alarm ARMS on the first
 * real interaction, and until then it says so on screen. A banner reading
 * "tap to enable sound" is not a nicety, it is the difference between an alarm
 * and the belief that there is one.
 *
 * ══ WHY POLLING ══════════════════════════════════════════════════════════
 *
 * See `ordersArrivedSince`. Ten seconds behind the staff cookie, rather than a
 * second authorisation system over customers' home addresses so a phone can
 * beep.
 */

interface ArrivedOrder {
  id: string;
  reference: string;
  placedAtMs: number;
  hasHotLine: boolean;
  estTotalCents: number;
}

interface Poll {
  now: number;
  orders: ArrivedOrder[];
  sound: boolean;
  message: string;
  pollSeconds: number;
  repeatUntilSeen: boolean;
}

export function NewOrderAlarm() {
  const [pending, setPending] = useState<ArrivedOrder[]>([]);
  const [armed, setArmed] = useState(false);
  const [muted, setMuted] = useState(false);

  /*
   * The cursor is a ref, not state. It changes on every poll, and as state it
   * would re-run the polling effect on every tick — turning a ten-second
   * interval into a tight loop of teardowns and setups.
   *
   * It starts at `Date.now()`, so opening the console does not announce every
   * order the shop has ever taken. The server sends its own `now` back and
   * that is what the cursor advances to, because the two clocks disagree and
   * the server's is the one the timestamps came from.
   */
  const since = useRef<number | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const settings = useRef({
    sound: true,
    message: 'New order received',
    repeat: false,
    pollSeconds: 10,
  });

  /** Create the AudioContext inside a gesture. Anywhere else it is suspended. */
  const arm = useCallback(() => {
    if (armed) return;
    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor !== undefined) {
        const ctx = new Ctor();
        void ctx.resume();
        audio.current = ctx;
      }
      /*
       * ⚠ SPEAK AN EMPTY UTTERANCE TO UNLOCK THE SPEECH QUEUE. Safari in
       * particular will not speak later unless `speak` has been called once
       * inside a gesture. A zero-length string makes no sound and does the
       * unlocking.
       */
      window.speechSynthesis?.speak(new SpeechSynthesisUtterance(''));
    } catch {
      // No audio on this device. The banner below still appears; the alarm
      // degrades to silent, which is worth knowing but not worth crashing for.
    }
    setArmed(true);
  }, [armed]);

  useEffect(() => {
    const events: (keyof DocumentEventMap)[] = ['pointerdown', 'keydown', 'touchstart'];
    const handler = () => arm();
    for (const e of events) document.addEventListener(e, handler, { once: true, passive: true });
    return () => {
      for (const e of events) document.removeEventListener(e, handler);
    };
  }, [arm]);

  const chime = useCallback(() => {
    const ctx = audio.current;
    if (ctx === null) return;

    /*
     * Two short sine tones a fifth apart. Deliberately not a square or saw
     * wave: this plays in a small tiled room and a harsh timbre at 6am is
     * something the owner will turn off, which makes the alarm useless in
     * exactly the way that is hardest to notice.
     */
    const now = ctx.currentTime;
    for (const [i, hz] of [880, 1318.5].entries()) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = hz;
      gain.gain.setValueAtTime(0.0001, now + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.25, now + i * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.18);
      osc.stop(now + i * 0.18 + 0.4);
    }
  }, []);

  const announce = useCallback(
    (count: number) => {
      if (muted || !settings.current.sound) return;
      chime();

      const speech = window.speechSynthesis;
      if (speech === undefined) return;
      const text =
        count > 1 ? `${settings.current.message}. ${count} orders.` : settings.current.message;
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.95;
      // Queued half a second behind the chime so the two do not overlap; the
      // chime is what turns a head, the sentence is what it turns towards.
      setTimeout(() => speech.speak(utterance), 500);
    },
    [chime, muted],
  );

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    /*
     * ⚠ THE CURSOR IS SEEDED HERE, IN THE EFFECT, NOT IN `useRef(Date.now())`.
     *
     * `Date.now()` during render is impure: React may render a component more
     * than once, and each render would produce a different starting cursor. It
     * is also wrong under StrictMode's double render. Seeding it on the first
     * tick makes it happen exactly once, in a place where a side effect is the
     * point.
     */
    if (since.current === null) since.current = Date.now();

    async function tick() {
      try {
        const res = await fetch(`/api/admin/events?since=${since.current}`, { cache: 'no-store' });
        if (res.ok) {
          const body = (await res.json()) as Poll;
          if (cancelled) return;

          settings.current = {
            sound: body.sound,
            message: body.message,
            repeat: body.repeatUntilSeen,
            pollSeconds: body.pollSeconds,
          };
          since.current = body.now;

          if (body.orders.length > 0) {
            setPending((current) => [...current, ...body.orders]);
            announce(body.orders.length);
          } else if (body.repeatUntilSeen) {
            /*
             * The "keep ringing" setting. It re-announces what is still
             * unacknowledged rather than what just arrived — otherwise the
             * setting would do nothing at all, because a repeat poll returns
             * an empty list by construction.
             */
            setPending((current) => {
              if (current.length > 0) announce(current.length);
              return current;
            });
          }
        }
      } catch {
        // A dropped poll is not an event. The next one covers the gap, because
        // the cursor only advances on a successful response.
      }

      if (!cancelled) {
        /*
         * ⚠ `setTimeout` CHAINED FROM THE END OF THE REQUEST, NOT
         * `setInterval`. An interval fires whether or not the previous poll
         * came back, so a console on a bad connection queues requests faster
         * than it drains them — and the free instance is the thing that ends
         * up paying for it. Chaining means one request in flight, ever.
         *
         * The interval is re-read from the ref every tick, so changing it in
         * the settings screen takes effect on the next poll rather than on a
         * reload.
         */
        timer = setTimeout(() => void tick(), settings.current.pollSeconds * 1000);
      }
    }

    void tick();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [announce]);

  if (!armed) {
    return (
      /*
        🔴 `text-hot-ink`, NOT `text-midnight`, AND IT WAS `text-midnight` UNTIL
        NOW. `--hot` is near-black in the light scheme and `--midnight` is
        near-black in both, so this prompt has been painting #031923 on #0d1b22
        — about 1.1:1 — for its whole life. It reads in dark mode, where `--hot`
        inverts to near-white, which is why it survived review. `--hot-ink` is
        the token that flips WITH `--hot` and is the pair the palette test
        asserts.
      */
      <div className="flex items-center gap-2 bg-hot px-4 py-2 text-meta font-semibold text-hot-ink">
        <BellRingingIcon size={16} weight="fill" aria-hidden />
        <span>Tap anywhere to turn on the new-order sound.</span>
      </div>
    );
  }

  if (pending.length === 0) {
    return muted ? (
      <button
        type="button"
        onClick={() => setMuted(false)}
        className="flex w-full items-center gap-2 bg-soft px-4 py-2 text-left text-meta text-muted"
      >
        <BellRingingIcon size={16} aria-hidden />
        <span>New-order sound is muted for this device. Tap to unmute.</span>
      </button>
    ) : null;
  }

  return (
    <div
      role="status"
      aria-live="assertive"
      className="bg-accent px-4 py-3 text-accent-ink"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-lead font-semibold">
            {pending.length === 1 ? 'New order' : `${pending.length} new orders`}
          </p>
          <p className="truncate text-meta opacity-90">
            {pending.map((o) => o.reference).join(', ')}
            {pending.some((o) => o.hasHotLine) ? ' · hot kitchen' : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/admin/orders"
            onClick={() => setPending([])}
            className="tap rounded-sm bg-accent-ink/15 px-3 text-body font-semibold"
          >
            Open
          </Link>
          <button
            type="button"
            onClick={() => {
              setPending([]);
              window.speechSynthesis?.cancel();
            }}
            aria-label="Dismiss"
            className="tap grid w-11 place-items-center rounded-sm"
          >
            <XIcon size={18} aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}
