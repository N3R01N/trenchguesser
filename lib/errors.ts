/**
 * An error the client is allowed to read, carrying the status it should get.
 *
 * It lives apart from the state machine so that a universe source can raise one
 * — a missing API key is a fact the host needs to see, not a mystery 500 — even
 * though room.ts is what imports the sources.
 */
export class RoomError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'RoomError';
    this.status = status;
  }
}
