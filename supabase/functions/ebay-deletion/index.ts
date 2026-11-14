import { admin, checked, env } from '../_shared/core.ts';
import { tokenGrant } from '../_shared/ebay.ts';

/**
 * eBay Marketplace Account Deletion endpoint.
 *
 * eBay verifies this endpoint with a GET challenge, then delivers deletion
 * notifications by POST. Two rules keep this safe:
 *   1. The challenge response is SHA-256 over challengeCode + token + endpoint,
 *      concatenated in that exact order, hex encoded.
 *   2. A POST is only honoured when the X-EBAY-SIGNATURE header verifies against
 *      eBay's published key. Without that check this URL is a delete button
 *      that anyone could press.
 */

const NOTIFICATION_API = 'https://api.ebay.com/commerce/notification/v1/public_key';
const KEY_TTL_MS = 60 * 60 * 1000;

const keyCache = new Map<string, { key: CryptoKey; expires: number }>();

function assertConfigured() {
  // Both values must exist before eBay can verify this endpoint.
  return {
    token: env('EBAY_VERIFICATION_TOKEN'),
    endpoint: env('EBAY_DELETION_ENDPOINT'),
  };
}

async function sha256Hex(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(v => v.toString(16).padStart(2, '0')).join('');
}

/** eBay signs with ECDSA/SHA-1 and sends DER, while WebCrypto wants raw r||s. */
function derToRaw(signature: Uint8Array) {
  if (signature.length === 64) return signature;
  if (signature[0] !== 0x30) throw new Error('Unexpected signature encoding');
  let offset = 2;
  if (signature[1] & 0x80) offset += signature[1] & 0x7f;
  const read = () => {
    if (signature[offset] !== 0x02) throw new Error('Unexpected signature encoding');
    const length = signature[offset + 1];
    const start = offset + 2;
    offset = start + length;
    return signature.subarray(start, start + length);
  };
  const raw = new Uint8Array(64);
  for (const [index, part] of [read(), read()].entries()) {
    // Strip the DER sign padding byte, then left-pad to the 32-byte field size.
    const value = part[0] === 0x00 ? part.subarray(1) : part;
    if (value.length > 32) throw new Error('Unexpected signature length');
    raw.set(value, index * 32 + (32 - value.length));
  }
  return raw;
}

async function notificationKey(kid: string) {
  const cached = keyCache.get(kid);
  if (cached && cached.expires > Date.now()) return cached.key;
  // getPublicKey is production-only; the app token is requested from the same host.
  const grant = await tokenGrant(new URLSearchParams({ grant_type: 'client_credentials', scope: 'https://api.ebay.com/oauth/api_scope' }));
  const response = await fetch(`${NOTIFICATION_API}/${encodeURIComponent(kid)}`, {
    headers: { Authorization: `Bearer ${grant.access_token}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Public key lookup failed (HTTP ${response.status})`);
  const body = await response.json();
  const der = Uint8Array.from(atob(String(body.key)), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('spki', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  keyCache.set(kid, { key, expires: Date.now() + KEY_TTL_MS });
  return key;
}

async function signatureValid(header: string, payload: Uint8Array) {
  const decoded = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(header), c => c.charCodeAt(0))));
  if (typeof decoded?.kid !== 'string' || typeof decoded?.signature !== 'string') return false;
  // Bound the key id before it reaches an outbound request.
  if (!/^[A-Za-z0-9+/=_-]{1,200}$/.test(decoded.kid)) return false;
  if (decoded.alg && !/ecdsa/i.test(String(decoded.alg))) return false;
  const key = await notificationKey(decoded.kid);
  const signature = derToRaw(Uint8Array.from(atob(decoded.signature), c => c.charCodeAt(0)));
  // Copy into array-buffer-backed views; WebCrypto does not accept shared buffers.
  return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-1' }, key, new Uint8Array(signature), new Uint8Array(payload));
}

/** Tables that hold seller data derived from eBay, removed per deletion request. */
const OWNED_TABLES = ['products', 'listings', 'buyer_offers', 'orders', 'traffic_daily', 'action_queue', 'automation_runs', 'store_settings'];

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

Deno.serve(async req => {
  const { token, endpoint } = assertConfigured();

  if (req.method === 'GET') {
    const challenge = new URL(req.url).searchParams.get('challenge_code');
    if (!challenge || challenge.length > 500) return respond({ error: 'Missing challenge_code.' }, 400);
    return respond({ challengeResponse: await sha256Hex(challenge + token + endpoint) });
  }

  if (req.method !== 'POST') return respond({ error: 'Method not allowed.' }, 405);

  const payload = new Uint8Array(await req.arrayBuffer());
  const header = req.headers.get('x-ebay-signature');
  // Never delete on an unverified request. Any failure while verifying — a
  // malformed header, an unknown key id, a key lookup error — is a rejection.
  let verified = false;
  if (header) {
    try {
      verified = await signatureValid(header, payload);
    } catch (error) {
      console.warn('Signature verification failed', error instanceof Error ? error.message : 'unknown error');
    }
  }
  if (!verified) return new Response(null, { status: 412, headers: { 'Cache-Control': 'no-store' } });

  let event: any;
  try {
    event = JSON.parse(new TextDecoder().decode(payload));
  } catch {
    return respond({ error: 'Invalid payload.' }, 400);
  }

  const data = event?.notification?.data ?? {};
  const ebayUserId = typeof data.userId === 'string' ? data.userId : '';
  if (!ebayUserId) {
    // Acknowledge so eBay does not retry a notification we cannot action.
    console.warn('Deletion notification without a userId', event?.notification?.notificationId);
    return respond({});
  }

  const db = admin();
  const credentials = checked(await db.from('ebay_credentials').select('owner_id').eq('ebay_user_id', ebayUserId).maybeSingle());

  // Idempotent: a repeated notification for already-deleted data is a success.
  if (!credentials) {
    console.log('Deletion notification for an unknown eBay user', ebayUserId);
    return respond({});
  }

  const owner = credentials.owner_id as string;
  for (const table of OWNED_TABLES) {
    checked(await db.from(table).delete().eq('owner_id', owner));
  }
  checked(await db.from('oauth_states').delete().eq('owner_id', owner));
  checked(await db.from('job_locks').delete().eq('owner_id', owner));
  // Removing this row drops the stored refresh/access tokens as well.
  checked(await db.from('ebay_credentials').delete().eq('owner_id', owner));

  // Deliberately kept: the Supabase login and console_operators allowlist entry.
  // Those are our own identity records, not eBay data, and keeping them lets the
  // operator sign in again and reconnect if the deletion was a mistake.
  console.log('Marketplace account deletion completed for owner', owner);
  return respond({});
});
