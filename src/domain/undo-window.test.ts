import { describe, expect, it } from "vitest";
import { DEFAULT_UNDO_SEND_SECONDS, isCancellable, undoDeadline } from "./undo-window";

describe("undo window", () => {
  it("defaults to exactly 10 seconds", () => {
    const confirmedAt = new Date("2026-10-13T18:30:00.000Z");
    expect(DEFAULT_UNDO_SEND_SECONDS).toBe(10);
    expect(undoDeadline(confirmedAt).toISOString()).toBe("2026-10-13T18:30:10.000Z");
  });

  it("is cancellable through the exact deadline", () => {
    const deadline = new Date("2026-10-13T18:30:10.000Z");
    expect(isCancellable(deadline, new Date("2026-10-13T18:30:10.000Z"))).toBe(true);
    expect(isCancellable(deadline, new Date("2026-10-13T18:30:10.001Z"))).toBe(false);
  });
});
