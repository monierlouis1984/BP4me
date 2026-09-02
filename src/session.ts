// Who is calling. BP4me sits behind the louismonier-gate Worker, which
// verifies the portal session cookie (HMAC-SHA256 token, payload
// { sub, via, exp }) and forwards the request unchanged, cookie included.
// We read `sub` from that cookie to key the user's data.
//
// The gate is the only way to reach this Worker (no routes, no workers.dev),
// so a request that gets here has already passed verification. If
// SESSION_SECRET is also configured on this Worker the signature is
// re-verified here as well (defence in depth); otherwise the payload is
// decoded and only its expiry is checked.
//
// Local `wrangler dev` has no gate and no cookie: set BP4ME_DEV_USER in
// .dev.vars to act as that user.

export interface SessionEnv {
  SESSION_SECRET?: string;
  BP4ME_DEV_USER?: string;
}

const SESSION_COOKIE = "__Secure-lm_session";
const encoder = new TextEncoder();

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

function b64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function verifySignature(body: string, sig: string, secret: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    return await crypto.subtle.verify("HMAC", key, b64urlDecode(sig), encoder.encode(body));
  } catch {
    return false;
  }
}

/** Returns the user id for this request, or null when there is no valid session. */
export async function getUserId(request: Request, env: SessionEnv): Promise<string | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return env.BP4ME_DEV_USER || null;
  if (!token.includes(".")) return null;
  const [body, sig] = token.split(".", 2);
  if (env.SESSION_SECRET && !(await verifySignature(body, sig, env.SESSION_SECRET))) return null;
  let payload: { sub?: unknown; exp?: unknown };
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
  } catch {
    return null;
  }
  if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) return null;
  if (typeof payload.sub !== "string" || !payload.sub) return null;
  return payload.sub;
}
