/**
 * Progress sync (one Durable Object per sync code). Stores a single end-to-end encrypted blob — the
 * server never sees the code or the progress, only `id` = SHA-256 of the code and ciphertext.
 * Writes are optimistic: a PUT must name the revision it was based on, otherwise it gets a 409 with
 * the current copy so the app can merge and retry. Vaults untouched for VAULT_TTL_DAYS delete themselves.
 */
import { DurableObject } from 'cloudflare:workers';
import type { Env } from './index';

export const VAULT_MAX_BLOB = 1_000_000; // chars of base64 (a heavy user's progress is ~50 KB)
const VAULT_TTL_DAYS = 400;

interface Vault { rev: number; blob: string; at: number }

export class SyncVault extends DurableObject<Env> {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const cur = await this.ctx.storage.get<Vault>('v');

    if (req.method === 'GET') {
      if (!cur) return Response.json({ error: 'no such sync code' }, { status: 404 });
      // The app passes the revision it already has: answer without the blob when nothing changed.
      if (url.searchParams.get('rev') === String(cur.rev)) return Response.json({ rev: cur.rev, same: true });
      return Response.json({ rev: cur.rev, blob: cur.blob, at: cur.at });
    }

    if (req.method === 'PUT') {
      const body = (await req.json().catch(() => null)) as { baseRev?: unknown; blob?: unknown } | null;
      if (!body || typeof body.baseRev !== 'number' || typeof body.blob !== 'string' || !body.blob || body.blob.length > VAULT_MAX_BLOB)
        return Response.json({ error: 'bad request' }, { status: 400 });
      if ((cur?.rev ?? 0) !== body.baseRev) {
        if (!cur) return Response.json({ error: 'no such sync code' }, { status: 404 }); // deleted while this device was away
        return Response.json({ rev: cur.rev, blob: cur.blob, at: cur.at }, { status: 409 });
      }
      const next: Vault = { rev: (cur?.rev ?? 0) + 1, blob: body.blob, at: Date.now() };
      await this.ctx.storage.put('v', next);
      await this.ctx.storage.setAlarm(next.at + VAULT_TTL_DAYS * 86_400_000);
      return Response.json({ rev: next.rev, at: next.at });
    }

    if (req.method === 'DELETE') {
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      return Response.json({ ok: true });
    }
    return Response.json({ error: 'not found' }, { status: 404 });
  }

  async alarm() {
    const cur = await this.ctx.storage.get<Vault>('v');
    if (cur && Date.now() < cur.at + VAULT_TTL_DAYS * 86_400_000) { await this.ctx.storage.setAlarm(cur.at + VAULT_TTL_DAYS * 86_400_000); return; }
    await this.ctx.storage.deleteAll();
  }
}
