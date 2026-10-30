// Minimal Gmail REST client over fetch (gmail.readonly). No `server-only` import so the local
// scripts can reuse it; the app's configured instance lives in ./index.ts.
import type { BankEmail } from '@/features/bank-email/types';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export class GmailError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'GmailError';
  }
}

export interface GmailCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface HistoryRecord {
  id: string;
  messageIds: string[];
}

type Header = { name: string; value: string };
type Part = {
  mimeType?: string;
  headers?: Header[];
  body?: { data?: string };
  parts?: Part[];
};
type RawMessage = { id: string; internalDate: string; payload: Part };

export type GmailClient = ReturnType<typeof createGmailClient>;

export function createGmailClient(creds: GmailCredentials) {
  let token: { value: string; expiresAt: number } | null = null;

  async function accessToken() {
    if (token && token.expiresAt > Date.now() + 60_000) return token.value;
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      body: new URLSearchParams({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        refresh_token: creds.refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
    };
    if (!res.ok || !body.access_token) {
      const hint =
        body.error === 'invalid_grant' ? ' (refresh token revoked or expired: re-run npm run gmail:auth)' : '';
      throw new GmailError(`Gmail token refresh failed: ${body.error ?? res.status}${hint}`, res.status);
    }
    token = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
    return token.value;
  }

  async function get<T>(path: string, params: Record<string, string | string[] | undefined> = {}) {
    const url = new URL(API + path);
    for (const [key, value] of Object.entries(params)) {
      for (const item of [value].flat()) if (item !== undefined) url.searchParams.append(key, item);
    }
    const res = await fetch(url, { headers: { Authorization: `Bearer ${await accessToken()}` } });
    if (!res.ok) throw new GmailError(`Gmail GET ${path} failed: ${res.status} ${await res.text()}`, res.status);
    return (await res.json()) as T;
  }

  return {
    getProfile() {
      return get<{ emailAddress: string; historyId: string }>('/profile');
    },

    // Newest first. Follows pages until `limit` ids or the end of the results.
    async listMessageIds(q: string, limit = Infinity) {
      const ids: string[] = [];
      let pageToken: string | undefined;
      do {
        const page = await get<{ messages?: { id: string }[]; nextPageToken?: string }>('/messages', {
          q,
          maxResults: String(Math.min(500, limit - ids.length)),
          pageToken,
        });
        ids.push(...(page.messages ?? []).map((m) => m.id));
        pageToken = page.nextPageToken;
      } while (pageToken && ids.length < limit);
      return ids.slice(0, limit);
    },

    // Oldest record first. Throws GmailError 404 when startHistoryId is too old to resume from.
    async listHistory(startHistoryId: string) {
      const records: HistoryRecord[] = [];
      let historyId = startHistoryId;
      let pageToken: string | undefined;
      do {
        const page = await get<{
          history?: { id: string; messagesAdded?: { message: { id: string } }[] }[];
          historyId: string;
          nextPageToken?: string;
        }>('/history', { startHistoryId, historyTypes: 'messageAdded', maxResults: '500', pageToken });
        for (const h of page.history ?? []) {
          records.push({ id: h.id, messageIds: (h.messagesAdded ?? []).map((m) => m.message.id) });
        }
        historyId = page.historyId;
        pageToken = page.nextPageToken;
      } while (pageToken);
      return { records, historyId };
    },

    // Cheap header-only fetch, used to skip non-bank mail without downloading bodies.
    async getSender(id: string) {
      const msg = await get<RawMessage>(`/messages/${id}`, { format: 'metadata', metadataHeaders: ['From'] });
      return header(msg.payload, 'From');
    },

    async getEmail(id: string): Promise<BankEmail> {
      const msg = await get<RawMessage>(`/messages/${id}`, { format: 'full' });
      const bodies: { html?: string; text?: string } = {};
      collectBodies(msg.payload, bodies);
      return {
        id: msg.id,
        from: header(msg.payload, 'From'),
        subject: header(msg.payload, 'Subject'),
        html: bodies.html ?? null,
        text: bodies.text ?? null,
        receivedAt: new Date(Number(msg.internalDate)),
      };
    },
  };
}

function header(part: Part, name: string) {
  return part.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

function collectBodies(part: Part, out: { html?: string; text?: string }) {
  const data = part.body?.data;
  if (data && part.mimeType === 'text/html') out.html ??= Buffer.from(data, 'base64url').toString('utf8');
  if (data && part.mimeType === 'text/plain') out.text ??= Buffer.from(data, 'base64url').toString('utf8');
  for (const child of part.parts ?? []) collectBodies(child, out);
}
