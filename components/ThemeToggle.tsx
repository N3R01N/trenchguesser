'use client';

import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

const KEY = 'tg:theme';

function systemTheme(): Theme {
  try {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  } catch {
    return 'light';
  }
}

/**
 * Follows the system until someone says otherwise, then remembers.
 *
 * The choice is written to the same key the bootstrap script in the layout
 * reads, so a return visit paints the right way round rather than correcting
 * itself after the fact.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(KEY);
    } catch {
      // Private browsing. The system preference still applies.
    }
    setTheme(stored === 'light' || stored === 'dark' ? stored : systemTheme());
  }, []);

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // The switch still works, it just won't outlive the tab.
    }
  }

  // Server-rendered markup cannot know the answer, and an icon that flips on
  // hydration is worse than one that arrives a frame late.
  if (!theme) return <span className="theme-toggle" aria-hidden="true" />;

  const dark = theme === 'dark';

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
        {dark ? (
          <>
            <circle cx="12" cy="12" r="4.4" fill="currentColor" />
            <g stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2" />
              <path d="M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4L17 7M7 17l-1.6 1.6" />
            </g>
          </>
        ) : (
          <path
            d="M20 14.2A8.4 8.4 0 1 1 9.8 4a6.8 6.8 0 0 0 10.2 10.2z"
            fill="currentColor"
          />
        )}
      </svg>
    </button>
  );
}
