import { describe, expect, it } from "vitest";
import { scheduledMessage } from "./format";

describe("scheduledMessage", () => {
  it("shows the 10 second default and escapes user content", () => {
    const message = scheduledMessage({
      to: ["a@example.com"], subject: "A < B & C", attachmentCount: 0,
      deadline: new Date("2026-10-13T18:30:10Z"),
    });
    expect(message).toContain("sent in 10 seconds");
    expect(message).toContain("A &lt; B &amp; C");
  });
});
