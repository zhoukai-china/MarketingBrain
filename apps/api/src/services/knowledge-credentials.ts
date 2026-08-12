import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "../config/env.js";

interface EncryptedEnvelope {
  v: 1;
  iv: string;
  tag: string;
  data: string;
}

function encryptionKey(): Buffer {
  const source = env.KNOWLEDGE_CREDENTIALS_KEY ?? env.JWT_SECRET ?? "sitong-local-knowledge-credentials-development-only";
  return createHash("sha256").update(source).digest();
}

export function encryptKnowledgeCredentials(value: object): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const envelope: EncryptedEnvelope = {
    v: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: encrypted.toString("base64")
  };
  return Buffer.from(JSON.stringify(envelope), "utf8").toString("base64");
}

export function decryptKnowledgeCredentials<T extends object>(encoded: string): T {
  const envelope = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as EncryptedEnvelope;
  if (envelope.v !== 1) throw new Error("unsupported_credentials_version");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(envelope.data, "base64")),
    decipher.final()
  ]).toString("utf8");
  return JSON.parse(decrypted) as T;
}
