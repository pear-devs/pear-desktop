// Minimal HS256 JWTs, compatible with the tokens the original API server issued.

import { createHmac, timingSafeEqual } from "node:crypto";

export interface TokenPayload {
  id: string;
  iat: number;
}

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const HEADER = encode({ alg: "HS256", typ: "JWT" });

const signature = (data: string, secret: string) => createHmac("sha256", secret).update(data).digest();

export function signToken(payload: TokenPayload, secret: string) {
  const data = `${HEADER}.${encode(payload)}`;
  return `${data}.${signature(data, secret).toString("base64url")}`;
}

/** The payload of a valid token, or null. */
export function verifyToken(token: string, secret: string): TokenPayload | null {
  const [header, body, sig] = token.split(".");
  if (!header || !body || sig === undefined) return null;
  try {
    const { alg } = JSON.parse(Buffer.from(header, "base64url").toString()) as { alg?: string };
    if (alg !== "HS256") return null;
    const expected = signature(`${header}.${body}`, secret);
    const actual = Buffer.from(sig, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as Partial<TokenPayload>;
    return typeof payload.id === "string" && typeof payload.iat === "number" ? { id: payload.id, iat: payload.iat } : null;
  } catch {
    return null;
  }
}
