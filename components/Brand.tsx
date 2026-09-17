/**
 * The mark is a trench: a wedge cut clean out of a solid block.
 *
 * Drawn in `currentColor` against `--bg`, so it inverts with the theme for free
 * — black block with a white notch on paper, white block with a black notch at
 * night — and needs no second asset.
 */
export function Logo({ size = 44 }: { size?: number }) {
  return (
    <svg
      className="logo"
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role="img"
      aria-label="Trenchguesser"
    >
      <rect width="48" height="48" rx="11" fill="currentColor" />
      <path
        d="M13 13 L24 33 L35 13"
        fill="none"
        stroke="var(--bg)"
        strokeWidth="6.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Wordmark({ as: As = 'span' }: { as?: 'span' | 'h1' }) {
  return <As className="wordmark">Trenchguesser</As>;
}

/** Mark over wordmark, for the one screen that introduces the game. */
export function Brand() {
  return (
    <div className="brand">
      <Logo />
      <Wordmark as="h1" />
    </div>
  );
}
