/**
 * One player's social profile (one Durable Object per public player id): their published card,
 * friends and incoming friend requests. Friendships are mutual — both sides are always updated
 * together through the internal `/_link`, `/_unlink` and `/_request` calls between players.
 * Protocol: ../../src/lib/social/protocol.ts
 */
import { DurableObject } from 'cloudflare:workers';
import { validCard, PID_RE, SOCIAL_LIMITS, type PlayerCard, type FriendRequest, type MeView } from '../../src/lib/social/protocol';
import { cleanName } from '../../src/lib/mp/protocol';
import type { Env } from './index';

interface Rec { pid: string; keyHash: string; card: PlayerCard | null; friends: string[]; requests: FriendRequest[]; outgoing: string[]; createdAt: number }

export const sha256hex = async (s: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, '0')).join('');

const ok = (body: unknown) => Response.json(body);
const err = (status: number, error: string) => Response.json({ error }, { status });

export class PlayerStore extends DurableObject<Env> {
  private rec: Rec | null | undefined;
  private async load() { if (this.rec === undefined) this.rec = (await this.ctx.storage.get<Rec>('p')) ?? null; return this.rec; }
  private async save() { await this.ctx.storage.put('p', this.rec!); }
  private other(pid: string) { return this.env.PLAYERS.get(this.env.PLAYERS.idFromName(pid)); }
  private me(): MeView { const r = this.rec!; return { friends: r.friends, requests: r.requests, outgoing: r.outgoing }; }
  private addFriend(pid: string) {
    const r = this.rec!;
    if (!r.friends.includes(pid) && r.friends.length < SOCIAL_LIMITS.friends) r.friends.push(pid);
    r.requests = r.requests.filter((x) => x.pid !== pid);
    r.outgoing = r.outgoing.filter((x) => x !== pid);
  }

  async fetch(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname;
    const body = req.method === 'POST' ? ((await req.json().catch(() => ({}))) as Record<string, unknown>) : {};
    const r = await this.load();

    if (path === '/_create') {
      if (r) return err(409, 'taken');
      this.rec = { pid: String(body.pid), keyHash: String(body.keyHash), card: null, friends: [], requests: [], outgoing: [], createdAt: Date.now() };
      await this.save();
      return ok({ pid: this.rec.pid });
    }
    if (!r) return err(404, 'no such player');

    if (path === '/card') return r.card ? ok(r.card) : err(404, 'this player has no profile yet');

    // ---- internal calls from another player's object (never routed from the outside) ----
    const from = typeof body.from === 'string' && PID_RE.test(body.from) ? body.from : null;
    if (path === '/_link' && from) { this.addFriend(from); await this.save(); return ok({ ok: true }); }
    if (path === '/_unlink' && from) {
      r.friends = r.friends.filter((x) => x !== from); r.requests = r.requests.filter((x) => x.pid !== from); r.outgoing = r.outgoing.filter((x) => x !== from);
      await this.save(); return ok({ ok: true });
    }
    if (path === '/_request' && from) {
      if (r.friends.includes(from)) return ok({ linked: true });
      if (r.outgoing.includes(from)) { this.addFriend(from); await this.save(); return ok({ linked: true }); } // both asked: friends
      if (!r.requests.some((x) => x.pid === from)) {
        r.requests.push({ pid: from, name: cleanName(String(body.name ?? '')), at: Date.now() });
        r.requests = r.requests.slice(-SOCIAL_LIMITS.requests);
        await this.save();
      }
      return ok({ linked: false });
    }
    if (path.startsWith('/_')) return err(404, 'not found');

    // ---- the owner's calls ----
    if (typeof body.key !== 'string' || (await sha256hex(body.key)) !== r.keyHash) return err(403, 'not your profile');

    if (path === '/me') {
      if (body.card !== undefined) {
        const card = validCard(body.card, r.pid);
        if (!card) return err(400, 'invalid card');
        r.card = card;
        await this.save();
      }
      return ok(this.me());
    }
    if (path === '/board') {
      const cards = await Promise.all(r.friends.map((f) => this.other(f).fetch('https://player/card').then((x) => (x.ok ? (x.json() as Promise<PlayerCard>) : null)).catch(() => null)));
      return ok({ cards: [r.card, ...cards].filter(Boolean) });
    }

    const other = typeof body.other === 'string' && PID_RE.test(body.other) ? body.other : null;
    if (!other) return err(400, 'bad player id');
    if (other === r.pid) return err(400, 'that’s your own code');

    if (path === '/add') {
      if (r.friends.length >= SOCIAL_LIMITS.friends) return err(409, `you can have up to ${SOCIAL_LIMITS.friends} friends`);
      if (r.friends.includes(other)) return ok(this.me());
      const name = r.card?.name ?? 'Explorer';
      if (body.via === 'code' || r.requests.some((x) => x.pid === other)) {
        // They shared their code (or already asked us): friends straight away on both sides.
        const res = await this.other(other).fetch('https://player/_link', { method: 'POST', body: JSON.stringify({ from: r.pid }) });
        if (res.status === 404) return err(404, 'no player with that code');
        this.addFriend(other);
      } else {
        const res = await this.other(other).fetch('https://player/_request', { method: 'POST', body: JSON.stringify({ from: r.pid, name }) });
        if (res.status === 404) return err(404, 'no such player');
        const { linked } = (await res.json()) as { linked: boolean };
        if (linked) this.addFriend(other);
        else if (!r.outgoing.includes(other)) r.outgoing = [...r.outgoing, other].slice(-SOCIAL_LIMITS.requests);
      }
      await this.save();
      return ok(this.me());
    }
    if (path === '/respond') {
      if (!r.requests.some((x) => x.pid === other)) return ok(this.me());
      if (body.accept === true) {
        const res = await this.other(other).fetch('https://player/_link', { method: 'POST', body: JSON.stringify({ from: r.pid }) });
        if (res.ok) this.addFriend(other);
        else r.requests = r.requests.filter((x) => x.pid !== other); // they deleted their profile
      } else {
        r.requests = r.requests.filter((x) => x.pid !== other);
      }
      await this.save();
      return ok(this.me());
    }
    if (path === '/remove') {
      await this.other(other).fetch('https://player/_unlink', { method: 'POST', body: JSON.stringify({ from: r.pid }) }).catch(() => {});
      r.friends = r.friends.filter((x) => x !== other); r.outgoing = r.outgoing.filter((x) => x !== other);
      await this.save();
      return ok(this.me());
    }
    return err(404, 'not found');
  }
}
