'use client';

/**
 * Who you are, kept on the device.
 *
 * No accounts: a player is a random id handed out by the server plus a display
 * name. Storing it per room code is what lets a phone rejoin after a refresh or
 * a locked screen. Every access is guarded — private browsing and blocked site
 * data both throw here.
 */

const KEY = 'tg:identity';

interface Identity {
  name: string;
  /** room code -> player id */
  rooms: Record<string, string>;
}

function read(): Identity {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { name: '', rooms: {} };
    const parsed = JSON.parse(raw) as Partial<Identity>;
    return { name: parsed.name ?? '', rooms: parsed.rooms ?? {} };
  } catch {
    return { name: '', rooms: {} };
  }
}

function write(next: Identity): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Nothing to do — the session simply won't survive a refresh.
  }
}

export function rememberPlayer(code: string, playerId: string, name?: string): void {
  const id = read();
  id.rooms[code.toUpperCase()] = playerId;
  if (name) id.name = name;
  write(id);
}

export function playerFor(code: string): string | null {
  return read().rooms[code.toUpperCase()] ?? null;
}

export function lastName(): string {
  return read().name;
}

export function forgetPlayer(code: string): void {
  const id = read();
  delete id.rooms[code.toUpperCase()];
  write(id);
}
