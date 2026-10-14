import { describe, expect, it } from "vitest";
import { draftPreview, scheduledMessage } from "./format";

describe("scheduledMessage", () => {
  it("shows the 10 second default and escapes user content", () => {
    const message = scheduledMessage({
      to: ["a@example.com"], subject: "A < B & C", attachmentCount: 0,
      deadline: new Date("2026-10-13T18:30:10Z"),
    });
    expect(message).toContain("sent in 10 seconds");
    expect(message).toContain("A &lt; B &amp; C");
  });
  it("lists safe attachment filenames in reply previews", () => {
    const message = draftPreview({
      to: ["client@example.com"], subject: "Photos", body: "Attached",
      attachmentCount: 2, attachmentNames: ["IMG_001.jpg", "quote <final>.pdf"],
    });
    expect(message).toContain("IMG_001.jpg");
    expect(message).toContain("quote &lt;final&gt;.pdf");
  });
});
