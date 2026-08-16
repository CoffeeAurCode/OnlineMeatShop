'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { Settings } from '@/db/repositories/settings';

import { PrimaryBar, PrimaryButton, SecondaryButton } from './shell';

/**
 * The console's own settings. Today that is the new-order alarm.
 *
 * ⭐ THE "TEST IT" BUTTON IS NOT A CONVENIENCE, IT IS THE POINT.
 *
 * Browsers refuse to make noise until the user has interacted with the page,
 * device volume is a physical switch nobody remembers, and `speechSynthesis`
 * has no voice installed on some Android builds. Every one of those failures
 * is SILENT — the settings save, the switch says "on", and the shop hears
 * nothing at 6am. The only honest way to configure an alarm is to make it ring
 * while you are looking at it.
 *
 * ⚠ THE MESSAGE IS SPOKEN OUT LOUD, so it is capped at 120 characters. Once
 * `speak` starts on a paragraph there is no graceful way to stop it over a
 * busy counter.
 */
export function SettingsForm({ settings }: { settings: Settings }) {
  const router = useRouter();
  const [sound, setSound] = useState(settings['console.newOrderSound']);
  const [message, setMessage] = useState(settings['console.newOrderMessage']);
  const [pollSeconds, setPollSeconds] = useState(String(settings['console.pollSeconds']));
  const [repeat, setRepeat] = useState(settings['console.repeatUntilSeen']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function preview() {
    /*
     * Called from a click handler, so it is inside a user gesture and the
     * browser will allow it. That is exactly the condition the alarm itself
     * cannot rely on, which is why it arms on first interaction instead.
     */
    const speech = window.speechSynthesis;
    if (speech === undefined) {
      setError('This browser cannot speak. The chime will still play.');
      return;
    }
    speech.cancel();
    speech.speak(new SpeechSynthesisUtterance(message));
  }

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          newOrderSound: sound,
          newOrderMessage: message.trim(),
          pollSeconds: Number(pollSeconds) || 10,
          repeatUntilSeen: repeat,
        }),
      });
      if (!res.ok) {
        setError('That did not save. Nothing has changed.');
        setBusy(false);
        return;
      }
      setSaved(true);
      router.refresh();
      setBusy(false);
    } catch {
      setError('That did not save. Check the connection and try again.');
      setBusy(false);
    }
  }

  return (
    <>
      <div className="mt-6 grid gap-5">
        <label className="flex items-start gap-3 text-body">
          <input
            type="checkbox"
            checked={sound}
            onChange={(e) => setSound(e.target.checked)}
            className="mt-1 size-5"
          />
          <span>
            <span className="block font-semibold">Make a sound when an order arrives</span>
            <span className="block text-meta text-muted">
              Only while the console is open on a device. Nothing rings on a phone that is locked or
              has this closed.
            </span>
          </span>
        </label>

        <label className="grid gap-1">
          <span className="text-meta text-muted">What it says out loud</span>
          <input
            value={message}
            maxLength={120}
            onChange={(e) => setMessage(e.target.value)}
            className="tap-lg rounded-sm border border-line bg-raised px-3 text-lead text-ink"
          />
          <span className="text-meta text-muted">{message.length} of 120 characters</span>
        </label>

        <SecondaryButton type="button" onClick={preview}>
          Test the sound now
        </SecondaryButton>

        <label className="grid gap-1">
          <span className="text-meta text-muted">Check for new orders every (seconds)</span>
          <input
            inputMode="numeric"
            value={pollSeconds}
            onChange={(e) => setPollSeconds(e.target.value.replace(/\D/g, ''))}
            className="tap-lg tnum rounded-sm border border-line bg-raised px-3 text-lead text-ink"
          />
          <span className="text-meta text-muted">
            Between 5 and 60. Lower is faster and costs the shop nothing at this volume.
          </span>
        </label>

        <label className="flex items-start gap-3 text-body">
          <input
            type="checkbox"
            checked={repeat}
            onChange={(e) => setRepeat(e.target.checked)}
            className="mt-1 size-5"
          />
          <span>
            <span className="block font-semibold">Keep announcing until the order is opened</span>
            <span className="block text-meta text-muted">
              For a busy counter where one chime gets missed. It repeats on every check until the
              banner is dismissed or the order is opened.
            </span>
          </span>
        </label>

        {error !== null && (
          <p role="alert" className="rounded-sm bg-danger-wash px-3 py-2 text-body text-danger">
            {error}
          </p>
        )}
        {saved && <p className="text-body text-muted">Saved. It takes effect on the next check.</p>}
      </div>

      <PrimaryBar>
        <PrimaryButton type="button" disabled={busy} onClick={() => void save()}>
          Save
        </PrimaryButton>
      </PrimaryBar>
    </>
  );
}
