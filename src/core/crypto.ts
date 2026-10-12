import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Envelope encryption. Each organization has its own 256-bit data key, stored only
 * wrapped (encrypted) by the master key. Client content is sealed with the org's key
 * and bound to its record via AAD, so ciphertext moved to another tenant or record
 * fails authentication. Destroying an org's wrapped key renders its data unrecoverable.
 */
const ALG = "aes-256-gcm";
const VERSION = "v1";

export class CryptoError extends Error {}

let devKeyWarned = false;

export function masterKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const raw = env.DATA_ENCRYPTION_KEY;
  if (raw) {
    const key = Buffer.from(raw, "base64");
    if (key.length !== 32) throw new CryptoError("DATA_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
    return key;
  }
  if (env.NODE_ENV === "production") throw new CryptoError("DATA_ENCRYPTION_KEY is required in production");
  if (!devKeyWarned) {
    console.warn("[easier] DATA_ENCRYPTION_KEY not set; using an insecure development key");
    devKeyWarned = true;
  }
  return createHash("sha256").update("easier-insecure-development-key").digest();
}

function encrypt(key: Buffer, plaintext: Buffer, aad: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv(ALG, key, iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  return [VERSION, iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(".");
}

function decrypt(key: Buffer, sealed: string, aad: string): Buffer {
  const [v, iv, tag, ct] = sealed.split(".");
  if (v !== VERSION || !iv || !tag || ct === undefined) throw new CryptoError("Unrecognized ciphertext format");
  try {
    const d = createDecipheriv(ALG, key, Buffer.from(iv, "base64"));
    d.setAAD(Buffer.from(aad));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]);
  } catch {
    throw new CryptoError("Decryption failed: wrong key or context");
  }
}

export const newDataKey = () => randomBytes(32);

export const wrapKey = (dataKey: Buffer, orgId: string, master = masterKey()) => encrypt(master, dataKey, `org-key:${orgId}`);

export const unwrapKey = (wrapped: string, orgId: string, master = masterKey()) => decrypt(master, wrapped, `org-key:${orgId}`);

/** A per-organization sealer. `context` identifies the record, e.g. "documents:<id>:content". */
export class OrgVault {
  constructor(
    private readonly key: Buffer,
    readonly orgId: string,
  ) {}

  private aad(context: string) {
    return `org:${this.orgId}|${context}`;
  }

  seal(value: unknown, context: string): string {
    return encrypt(this.key, Buffer.from(JSON.stringify(value)), this.aad(context));
  }

  open<T = unknown>(sealed: string, context: string): T {
    return JSON.parse(decrypt(this.key, sealed, this.aad(context)).toString("utf8")) as T;
  }
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** HMAC-signed tokens for session cookies. */
export function sign(payload: string, secret: string): string {
  const mac = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${Buffer.from(payload).toString("base64url")}.${mac}`;
}

export function verify(token: string, secret: string): string | undefined {
  const [body, mac] = token.split(".");
  if (!body || !mac) return undefined;
  const payload = Buffer.from(body, "base64url").toString("utf8");
  const expected = createHmac("sha256", secret).update(payload).digest();
  const given = Buffer.from(mac, "base64url");
  return given.length === expected.length && timingSafeEqual(given, expected) ? payload : undefined;
}

export const randomToken = () => randomBytes(32).toString("base64url");
