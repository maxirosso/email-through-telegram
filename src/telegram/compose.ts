import { z } from "zod";

const email = z.email();

export function parseRecipients(value: string): Array<{ address: string }> {
  const candidates = value
    .split(/[;,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (!candidates.length || candidates.length > 20) {
    throw new Error("Enter between 1 and 20 email addresses.");
  }
  const addresses = candidates.map((address) => email.parse(address.toLowerCase()));
  return [...new Set(addresses)].map((address) => ({ address }));
}

export function validateSubject(value: string): string {
  const subject = value.trim();
  if (!subject) throw new Error("The subject cannot be empty.");
  if (subject.length > 255) throw new Error("The subject must be 255 characters or fewer.");
  return subject;
}

export function validateBody(value: string): string {
  const body = value.trim();
  if (!body) throw new Error("The message cannot be empty.");
  if (body.length > 20_000) throw new Error("The message must be 20,000 characters or fewer.");
  return body;
}
