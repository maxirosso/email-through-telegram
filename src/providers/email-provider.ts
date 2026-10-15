export type Recipient = { name?: string; address: string };

export interface DraftUpdate {
  subject: string;
  body: string;
  recipients: Recipient[];
}

export interface ProviderMessage {
  id: string;
  conversationId?: string;
  internetMessageId?: string;
  sender: Recipient;
  replyTo: Recipient[];
  recipients: Recipient[];
  subject: string;
  bodyPreview: string;
  receivedAt: Date;
  webLink?: string;
  hasAttachments: boolean;
}

export interface ProviderAttachment {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  inline: boolean;
}

export interface ProviderDraft {
  id: string;
  subject: string;
  body: string;
  recipients: Recipient[];
}

export interface MessageDeltaPage {
  messages: ProviderMessage[];
  nextLink?: string;
  deltaLink?: string;
}

export interface EmailProvider {
  readonly kind: "MICROSOFT";
  listMessageDelta(cursor?: string): Promise<MessageDeltaPage>;
  getMessage(messageId: string): Promise<ProviderMessage>;
  listMessageAttachments(messageId: string): Promise<ProviderAttachment[]>;
  downloadMessageAttachment(messageId: string, attachmentId: string): Promise<Uint8Array>;
  createDraft(update: DraftUpdate): Promise<{ id: string }>;
  createReplyDraft(messageId: string, replyAll: boolean): Promise<{ id: string }>;
  getDraft(draftId: string): Promise<ProviderDraft>;
  updateDraft(draftId: string, update: DraftUpdate): Promise<void>;
  addDraftAttachment(
    draftId: string,
    attachment: { filename: string; mimeType: string; bytes: Uint8Array },
  ): Promise<{ id: string }>;
  removeDraftAttachment(draftId: string, attachmentId: string): Promise<void>;
  sendDraft(draftId: string): Promise<void>;
  deleteDraft(draftId: string): Promise<void>;
}

export class ProviderRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly responseBody?: string,
  ) {
    super(message);
  }
}
