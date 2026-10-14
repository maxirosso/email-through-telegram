export const DEFAULT_UNDO_SEND_SECONDS = 10;

export function undoDeadline(confirmedAt: Date, seconds = DEFAULT_UNDO_SEND_SECONDS): Date {
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 300) {
    throw new RangeError("Undo window must be an integer between 1 and 300 seconds");
  }
  return new Date(confirmedAt.getTime() + seconds * 1000);
}

export function isCancellable(deadline: Date, now: Date): boolean {
  return now.getTime() <= deadline.getTime();
}
