import {
  DraftUpdate, EmailProvider, MessageDeltaPage, ProviderAttachment, ProviderDraft,
  ProviderMessage, ProviderRequestError, Recipient,
} from "./email-provider";

const GRAPH = "https://graph.microsoft.com/v1.0";
const MESSAGE_SELECT = [
  "id", "conversationId", "internetMessageId", "sender", "replyTo", "toRecipients",
  "ccRecipients", "subject", "bodyPreview", "receivedDateTime", "webLink", "hasAttachments",
].join(",");

type GraphRecipient = { emailAddress?: { name?: string; address?: string } };
type GraphMessage = {
  id: string; conversationId?: string; internetMessageId?: string; sender?: GraphRecipient;
  replyTo?: GraphRecipient[]; toRecipients?: GraphRecipient[]; ccRecipients?: GraphRecipient[];
  subject?: string; bodyPreview?: string; receivedDateTime?: string; webLink?: string;
  hasAttachments?: boolean; body?: { content?: string };
};
type GraphPage = { value: GraphMessage[]; "@odata.nextLink"?: string; "@odata.deltaLink"?: string };

function recipient(value?: GraphRecipient): Recipient | undefined {
  const address = value?.emailAddress?.address?.trim();
  return address ? { name: value?.emailAddress?.name || undefined, address } : undefined;
}

function normalizeMessage(message: GraphMessage): ProviderMessage {
  const sender = recipient(message.sender);
  if (!sender) throw new Error("Microsoft message did not include a sender");
  return {
    id: message.id,
    conversationId: message.conversationId,
    internetMessageId: message.internetMessageId,
    sender,
    replyTo: (message.replyTo ?? []).map(recipient).filter((x): x is Recipient => Boolean(x)),
    recipients: [...(message.toRecipients ?? []), ...(message.ccRecipients ?? [])]
      .map(recipient).filter((x): x is Recipient => Boolean(x)),
    subject: message.subject?.trim() || "(no subject)",
    bodyPreview: message.bodyPreview?.trim() || "",
    receivedAt: new Date(message.receivedDateTime ?? Date.now()),
    webLink: message.webLink,
    hasAttachments: Boolean(message.hasAttachments),
  };
}

export class MicrosoftGraphProvider implements EmailProvider {
  readonly kind = "MICROSOFT" as const;
  constructor(private readonly accessToken: string) {}

  private async request(pathOrUrl: string, init: RequestInit = {}): Promise<Response> {
    const url = pathOrUrl.startsWith("https://") ? pathOrUrl : `${GRAPH}${pathOrUrl}`;
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(30_000),
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        ...(init.body && typeof init.body === "string" ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
    if (!response.ok) {
      throw new ProviderRequestError(
        `Microsoft Graph request failed (${response.status})`, response.status, await response.text(),
      );
    }
    return response;
  }

  async listMessageDelta(cursor?: string): Promise<MessageDeltaPage> {
    const since = encodeURIComponent(new Date(Date.now() - 5 * 60_000).toISOString());
    const path = cursor ?? `/me/mailFolders/inbox/messages/delta?$select=${encodeURIComponent(MESSAGE_SELECT)}&$top=50&$filter=receivedDateTime%20ge%20${since}`;
    const response = await this.request(path, { headers: { Prefer: 'outlook.body-content-type="text"' } });
    const page = (await response.json()) as GraphPage;
    return {
      messages: page.value.filter((value) => value.id && value.sender).map(normalizeMessage),
      nextLink: page["@odata.nextLink"],
      deltaLink: page["@odata.deltaLink"],
    };
  }

  async getMessage(messageId: string): Promise<ProviderMessage> {
    const response = await this.request(
      `/me/messages/${encodeURIComponent(messageId)}?$select=${encodeURIComponent(MESSAGE_SELECT)}`,
      { headers: { Prefer: 'outlook.body-content-type="text"' } },
    );
    return normalizeMessage((await response.json()) as GraphMessage);
  }

  async listMessageAttachments(messageId: string): Promise<ProviderAttachment[]> {
    const response = await this.request(
      `/me/messages/${encodeURIComponent(messageId)}/attachments?$select=id,name,contentType,size,isInline`,
    );
    const page = (await response.json()) as {
      value: Array<{ id: string; name?: string; contentType?: string; size?: number; isInline?: boolean }>;
    };
    return page.value.map((item) => ({
      id: item.id, filename: item.name || "attachment", mimeType: item.contentType || "application/octet-stream",
      sizeBytes: item.size ?? 0, inline: Boolean(item.isInline),
    }));
  }

  async downloadMessageAttachment(messageId: string, attachmentId: string): Promise<Uint8Array> {
    const response = await this.request(
      `/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}/$value`,
      { headers: { Accept: "application/octet-stream" } },
    );
    return new Uint8Array(await response.arrayBuffer());
  }

  async createDraft(update: DraftUpdate): Promise<{ id: string }> {
    const response = await this.request("/me/messages", {
      method: "POST",
      body: JSON.stringify({
        subject: update.subject,
        body: { contentType: "Text", content: update.body },
        toRecipients: update.recipients.map(({ name, address }) => ({ emailAddress: { name, address } })),
      }),
    });
    return (await response.json()) as { id: string };
  }

  async createReplyDraft(messageId: string, replyAll: boolean): Promise<{ id: string }> {
    const action = replyAll ? "createReplyAll" : "createReply";
    const response = await this.request(`/me/messages/${encodeURIComponent(messageId)}/${action}`, {
      method: "POST", body: "{}",
    });
    return (await response.json()) as { id: string };
  }

  async getDraft(draftId: string): Promise<ProviderDraft> {
    const response = await this.request(
      `/me/messages/${encodeURIComponent(draftId)}?$select=id,subject,body,toRecipients,ccRecipients`,
      { headers: { Prefer: 'outlook.body-content-type="text"' } },
    );
    const value = (await response.json()) as GraphMessage;
    return {
      id: value.id,
      subject: value.subject?.trim() || "(no subject)",
      body: value.body?.content ?? "",
      recipients: [...(value.toRecipients ?? []), ...(value.ccRecipients ?? [])]
        .map(recipient).filter((x): x is Recipient => Boolean(x)),
    };
  }

  async updateDraft(draftId: string, update: DraftUpdate): Promise<void> {
    await this.request(`/me/messages/${encodeURIComponent(draftId)}`, {
      method: "PATCH",
      body: JSON.stringify({
        subject: update.subject,
        body: { contentType: "Text", content: update.body },
        toRecipients: update.recipients.map(({ name, address }) => ({ emailAddress: { name, address } })),
      }),
    });
  }

  async addDraftAttachment(
    draftId: string,
    attachment: { filename: string; mimeType: string; bytes: Uint8Array },
  ): Promise<{ id: string }> {
    if (attachment.bytes.byteLength <= 3 * 1024 * 1024) {
      const response = await this.request(`/me/messages/${encodeURIComponent(draftId)}/attachments`, {
        method: "POST",
        body: JSON.stringify({
          "@odata.type": "#microsoft.graph.fileAttachment", name: attachment.filename,
          contentType: attachment.mimeType, contentBytes: Buffer.from(attachment.bytes).toString("base64"),
        }),
      });
      return (await response.json()) as { id: string };
    }
    if (attachment.bytes.byteLength > 150 * 1024 * 1024) {
      throw new Error("Attachment exceeds Microsoft Graph's 150 MB limit");
    }
    const sessionResponse = await this.request(
      `/me/messages/${encodeURIComponent(draftId)}/attachments/createUploadSession`,
      {
        method: "POST",
        body: JSON.stringify({ AttachmentItem: {
          attachmentType: "file", name: attachment.filename, size: attachment.bytes.byteLength,
          contentType: attachment.mimeType,
        } }),
      },
    );
    const { uploadUrl } = (await sessionResponse.json()) as { uploadUrl: string };
    const chunkSize = 10 * 320 * 1024;
    let finalId: string | undefined;
    for (let start = 0; start < attachment.bytes.byteLength; start += chunkSize) {
      const end = Math.min(start + chunkSize, attachment.bytes.byteLength);
      const chunk = attachment.bytes.slice(start, end);
      const response = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Length": String(chunk.byteLength),
          "Content-Range": `bytes ${start}-${end - 1}/${attachment.bytes.byteLength}`,
        },
        body: Buffer.from(chunk),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) {
        throw new ProviderRequestError(`Microsoft upload failed (${response.status})`, response.status, await response.text());
      }
      if (response.status === 201) finalId = ((await response.json()) as { id?: string }).id;
    }
    if (!finalId) throw new Error("Microsoft attachment upload completed without an attachment id");
    return { id: finalId };
  }

  async removeDraftAttachment(draftId: string, attachmentId: string): Promise<void> {
    try {
      await this.request(`/me/messages/${encodeURIComponent(draftId)}/attachments/${encodeURIComponent(attachmentId)}`, { method: "DELETE" });
    } catch (error) {
      if (error instanceof ProviderRequestError && error.status === 404) return;
      throw error;
    }
  }
  async sendDraft(draftId: string): Promise<void> {
    await this.request(`/me/messages/${encodeURIComponent(draftId)}/send`, { method: "POST" });
  }
  async deleteDraft(draftId: string): Promise<void> {
    await this.request(`/me/messages/${encodeURIComponent(draftId)}`, { method: "DELETE" });
  }
}
