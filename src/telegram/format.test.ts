import { describe, expect, it } from "vitest";
import { composePrompt, draftPreview, friendlyDateTime, homeMessage, incomingEmailMessage, scheduledMessage } from "./format";

describe("scheduledMessage", () => {
  it("shows the 10 second default and escapes user content", () => {
    const message = scheduledMessage({
      to: ["a@example.com"], subject: "A < B & C", attachmentCount: 0,
      deadline: new Date("2026-10-13T18:30:10Z"),
      timezone: "UTC",
    });
    expect(message).toContain("Sending in 10 seconds");
    expect(message).toContain("A &lt; B &amp; C");
  });
  it("uses friendly local timestamps and clearly labels shortened email text", () => {
    expect(friendlyDateTime(
      new Date("2026-10-15T15:49:33Z"),
      "America/Buenos_Aires",
      new Date("2026-10-15T18:00:00Z"),
    )).toBe("Today at 12:49");
    const message = incomingEmailMessage({
      senderAddress: "client@example.com",
      subject: "A useful update",
      preview: "x".repeat(1_000),
      receivedAt: new Date("2026-10-15T15:49:33Z"),
      attachmentCount: 0,
      timezone: "America/Buenos_Aires",
    });
    expect(message).toContain("<b>Preview</b>");
    expect(message).toContain("Tap Read full email");
    expect(message).not.toContain("2026-10-15T15:49:33.000Z");
    expect(message.length).toBeLessThan(1_200);
  });
  it("lists safe attachment filenames in reply previews", () => {
    const message = draftPreview({
      to: ["client@example.com"], subject: "Photos", body: "Attached",
      attachmentCount: 2, attachmentNames: ["IMG_001.jpg", "quote <final>.pdf"],
    });
    expect(message).toContain("IMG_001.jpg");
    expect(message).toContain("quote &lt;final&gt;.pdf");
  });
  it("labels new-email previews and exposes a simple three-step compose flow", () => {
    const message = draftPreview({
      to: ["client@example.com"], subject: "Hello", body: "A new conversation",
      attachmentCount: 0, kind: "new",
    });
    expect(message).toContain("NEW EMAIL");
    expect(homeMessage()).toContain("What would you like to do?");
    expect(composePrompt("recipient")).toContain("1 of 3");
    expect(composePrompt("subject")).toContain("2 of 3");
    expect(composePrompt("body")).toContain("3 of 3");
  });
});
