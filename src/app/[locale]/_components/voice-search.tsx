'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MagnifyingGlassIcon, MicrophoneIcon, StopIcon } from '@phosphor-icons/react/dist/ssr';

import { t, type Locale } from '@/i18n';
import { parseVoiceCommand } from '@/ui/voice-command';

interface RecognitionResultLike {
  readonly isFinal: boolean;
  readonly 0?: { readonly transcript?: string };
}

interface RecognitionEventLike extends Event {
  readonly resultIndex: number;
  readonly results: ArrayLike<RecognitionResultLike>;
}

interface RecognitionErrorEventLike extends Event {
  readonly error: string;
}

interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: RecognitionEventLike) => void) | null;
  onerror: ((event: RecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type RecognitionConstructor = new () => RecognitionLike;

function recognitionConstructor(): RecognitionConstructor | null {
  const speechWindow = window as typeof window & {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

type Phase = 'idle' | 'listening' | 'processing' | 'error';

/** The shared top-bar search, enhanced with browser speech recognition. */
export function VoiceSearch({ locale }: { locale: Locale }) {
  const router = useRouter();
  const recognition = useRef<RecognitionLike | null>(null);
  const messageTimer = useRef<number | null>(null);
  const navigating = useRef(false);
  const [value, setValue] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState('');

  useEffect(
    () => () => {
      recognition.current?.abort();
      recognition.current = null;
      if (messageTimer.current !== null) window.clearTimeout(messageTimer.current);
    },
    [],
  );

  function voiceError(error: string): string {
    if (error === 'not-allowed' || error === 'service-not-allowed') {
      return t(locale, 'voice.permissionDenied');
    }
    if (error === 'no-speech') return t(locale, 'voice.noSpeech');
    if (error === 'audio-capture') return t(locale, 'voice.noMicrophone');
    return t(locale, 'voice.failed');
  }

  function submitTranscript(transcript: string): void {
    const command = parseVoiceCommand(transcript, locale);
    setValue(command.query);
    if (command.query === '') {
      setPhase('error');
      setMessage(t(locale, 'voice.noSpeech'));
      return;
    }

    navigating.current = true;
    setPhase('processing');
    setMessage(t(locale, 'voice.searching', { query: command.query }));

    const actionId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`;
    const params = new URLSearchParams({
      q: command.query,
      voice: actionId,
    });
    if (command.quantity?.kind === 'weight') {
      params.set('voiceQuantity', `weight:${command.quantity.grams}`);
    } else if (command.quantity?.kind === 'count') {
      params.set('voiceQuantity', `count:${command.quantity.value}`);
    }
    // A voice URL must not become a link that can mutate somebody else's cart.
    // The destination adds only when this browser marked the action pending.
    const voiceWindow = window as typeof window & { __pendingVoiceCartActions?: Set<string> };
    voiceWindow.__pendingVoiceCartActions ??= new Set<string>();
    voiceWindow.__pendingVoiceCartActions.add(actionId);
    try {
      window.sessionStorage.setItem(`voice-cart:${actionId}`, 'pending');
    } catch {
      // The in-memory marker above covers client navigation when storage is
      // blocked. sessionStorage adds resilience across a page reload.
    }

    router.push(`/${locale}/search?${params.toString()}`);
    if (messageTimer.current !== null) window.clearTimeout(messageTimer.current);
    messageTimer.current = window.setTimeout(() => {
      setPhase('idle');
      setMessage('');
      messageTimer.current = null;
    }, 2500);
  }

  function toggleListening(): void {
    if (phase === 'listening') {
      recognition.current?.stop();
      return;
    }

    const Recognition = recognitionConstructor();
    if (Recognition === null) {
      setPhase('error');
      setMessage(t(locale, 'voice.unavailable'));
      return;
    }

    navigating.current = false;
    const next = new Recognition();
    recognition.current = next;
    next.lang = locale === 'fr' ? 'fr-CA' : 'en-CA';
    next.continuous = false;
    next.interimResults = true;
    next.maxAlternatives = 1;

    next.onstart = () => {
      setPhase('listening');
      setMessage(t(locale, 'voice.listening'));
    };
    next.onresult = (event) => {
      let transcript = '';
      let final = false;
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        transcript += result?.[0]?.transcript ?? '';
        final ||= result?.isFinal ?? false;
      }
      const spoken = transcript.trim();
      if (spoken !== '') setValue(spoken);
      if (final && spoken !== '') submitTranscript(spoken);
    };
    next.onerror = (event) => {
      setPhase('error');
      setMessage(voiceError(event.error));
    };
    next.onend = () => {
      recognition.current = null;
      if (!navigating.current) {
        setPhase((current) => (current === 'listening' ? 'idle' : current));
        setMessage((current) => (current === t(locale, 'voice.listening') ? '' : current));
      }
    };

    try {
      next.start();
    } catch {
      recognition.current = null;
      setPhase('error');
      setMessage(t(locale, 'voice.failed'));
    }
  }

  const listening = phase === 'listening';

  return (
    <form
      action={`/${locale}/search`}
      method="get"
      role="search"
      className="relative min-w-0 flex-1 lg:max-w-[34rem]"
    >
      <label htmlFor="header-q" className="sr-only">
        {t(locale, 'nav.search')}
      </label>
      <MagnifyingGlassIcon
        size={18}
        aria-hidden
        className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted"
      />
      <input
        id="header-q"
        name="q"
        type="search"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          if (phase === 'error') {
            setPhase('idle');
            setMessage('');
          }
        }}
        placeholder={t(locale, 'nav.searchPlaceholder')}
        className="h-12 w-full rounded-full bg-raised pl-11 pr-14 text-body text-ink shadow-[0_8px_20px_-10px_rgb(3_25_35/0.5)] placeholder:text-muted"
      />
      <button
        type="button"
        onClick={toggleListening}
        aria-label={t(locale, listening ? 'voice.stop' : 'voice.start')}
        aria-pressed={listening}
        className={`press absolute right-0.5 top-0.5 grid size-11 place-items-center rounded-full transition-colors duration-(--duration-fast) ${
          listening ? 'bg-accent text-accent-ink' : 'text-muted hover:bg-soft hover:text-ink'
        }`}
      >
        {listening ? (
          <StopIcon size={18} weight="fill" aria-hidden />
        ) : (
          <MicrophoneIcon size={19} weight="bold" aria-hidden />
        )}
        {listening && (
          <span className="absolute inset-1 animate-ping rounded-full border border-current opacity-30 motion-reduce:animate-none" />
        )}
      </button>

      {message !== '' && (
        <p
          role={phase === 'error' ? 'alert' : 'status'}
          className="absolute right-0 top-[calc(100%+0.5rem)] max-w-[min(22rem,calc(100vw-2rem))] rounded-sm border border-line bg-raised px-3 py-2 text-meta text-ink elev-card"
        >
          {message}
        </p>
      )}
    </form>
  );
}
