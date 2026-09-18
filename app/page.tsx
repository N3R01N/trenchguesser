'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { post } from '@/lib/client.ts';
import { lastName, rememberPlayer } from '@/lib/identity.ts';
import { Spinner } from '@/components/ui.tsx';
import { Brand } from '@/components/Brand.tsx';
import { ThemeToggle } from '@/components/ThemeToggle.tsx';

/**
 * Asks whether a code opens the input-concepts page.
 *
 * The browser never holds the answer: it offers the code and the server says
 * yes or no, so the only way to find the page is to know what to type. A full
 * navigation rather than a router push, because what comes back is a page of
 * its own rather than a screen of this app.
 */
async function openIfDemo(code: string): Promise<boolean> {
  const at = `/demo/${encodeURIComponent(code)}`;
  try {
    const res = await fetch(at, { method: 'HEAD', cache: 'no-store' });
    if (!res.ok) return false;
    window.location.assign(at);
    return true;
  } catch {
    return false; // offline, or the route is not deployed — just join instead
  }
}

export default function Home() {
  const router = useRouter();
  const [joining, setJoining] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function openJoin() {
    setName((n) => n || lastName());
    setJoining(true);
  }

  // A full code is worth one question before anybody has typed a name.
  const clean = code.trim().toUpperCase();
  useEffect(() => {
    if (clean.length < 4) return;
    const t = setTimeout(() => void openIfDemo(clean), 300);
    return () => clearTimeout(t);
  }, [clean]);

  async function join(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (await openIfDemo(clean)) return;
      const res = await post<{ code: string; playerId: string }>(
        `/api/room/${encodeURIComponent(clean)}/join`,
        { name },
      );
      rememberPlayer(res.code, res.playerId, name);
      router.push(`/room/${res.code}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="screen">
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <ThemeToggle />
      </div>

      <div className="screen-body center" style={{ justifyContent: 'center' }}>
        <Brand />
        <p className="muted">
          Spin a number. That is a coin&apos;s rank by market cap, or a
          collection&apos;s by all-time volume. Guess what it&apos;s worth before
          the clock runs out.
        </p>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="screen-foot">
        {joining ? (
          <form className="stack" onSubmit={join}>
            <div className="field">
              <span className="label">Game code</span>
              <input
                type="text"
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="off"
                autoFocus
                maxLength={4}
                placeholder="K4XP"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                className="mono"
                style={{ fontSize: 24, letterSpacing: '0.2em', textAlign: 'center' }}
              />
            </div>
            <div className="field">
              <span className="label">Your name</span>
              <input
                type="text"
                maxLength={16}
                placeholder="Degen McGee"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <button
              className="btn btn-primary btn-lg"
              disabled={busy || code.trim().length < 4 || !name.trim()}
            >
              {busy ? (
                <>
                  <Spinner size={16} />
                  Joining…
                </>
              ) : (
                'Join game'
              )}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setJoining(false)}
            >
              Back
            </button>
          </form>
        ) : (
          <>
            <button
              className="btn btn-primary btn-lg"
              onClick={() => router.push('/host')}
            >
              Host a game
            </button>
            <button className="btn btn-lg" onClick={openJoin}>
              Join a game
            </button>
          </>
        )}
      </div>
    </main>
  );
}
