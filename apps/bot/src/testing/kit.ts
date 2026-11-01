import type { ItemKey } from '@crystalaid/domain';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ApiClient } from '../api.js';
import type { DiscordPort, LogMessage, MsgRef, OfferStore, OutMessage } from '../ports.js';

export const id = (n: number): string => (100000000000000000n + BigInt(n)).toString();
export const TICKET = '11111111-2222-4333-8444-555555555555';
export const CFG = {
  guildId: id(1),
  timezone: 'Europe/Moscow',
  channels: { help: id(900), log: id(901) },
  roles: { support: [id(11)], curator: [id(12)], admin: [id(13)] },
  users: { admins: [id(20)], developers: [id(21)] },
};

type Handler = (body: unknown, query: URLSearchParams) => { status?: number; json: unknown };

/** A stand-in for the API: the real ApiClient talks to it over HTTP. */
export class ApiStub {
  readonly calls: { route: string; body: unknown; query: Record<string, string>; auth: string | undefined }[] = [];
  private routes = new Map<string, Handler>();
  private server!: Server;
  url = '';

  on(route: string, handler: Handler): this {
    this.routes.set(route, handler);
    return this;
  }
  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const url = new URL(req.url ?? '/', 'http://x');
        const route = `${req.method} ${url.pathname.replace(/[0-9a-f-]{36}/, ':id')}`;
        const raw = Buffer.concat(chunks).toString();
        const body: unknown = raw ? JSON.parse(raw) : undefined;
        this.calls.push({ route, body, query: Object.fromEntries(url.searchParams), auth: req.headers.authorization });
        const h = this.routes.get(route);
        const out = h ? h(body, url.searchParams) : { status: 404, json: { error: { code: 'NOT_FOUND', message: 'x' } } };
        res.writeHead(out.status ?? 200, { 'content-type': 'application/json' }).end(JSON.stringify(out.json));
      });
    });
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }
  stop(): Promise<void> {
    return new Promise((r) => this.server.close(() => r()));
  }
  client(): ApiClient {
    return new ApiClient(this.url, 'service-token');
  }
  called(route: string) {
    return this.calls.filter((c) => c.route === route);
  }
}

export const apiError = (status: number, code: string, reason?: string) => ({
  status,
  json: { error: { code, message: 'x', ...(reason ? { reason } : {}) } },
});

export class FakeDiscord implements DiscordPort {
  dms: { userId: string; msg: OutMessage; ref: MsgRef }[] = [];
  edits: { ref: MsgRef; msg: OutMessage }[] = [];
  logs: LogMessage[] = [];
  closedDms = new Set<string>();
  brokenLog = false;
  /** Log sends that fail before one succeeds. */
  logFailures = 0;
  archived: { file: { url: string; name: string }; caption: string }[] = [];
  brokenArchive = false;
  private n = 0;

  async sendDm(userId: string, msg: OutMessage): Promise<MsgRef> {
    if (this.closedDms.has(userId)) throw Object.assign(new Error('Cannot send messages to this user'), { code: 50007 });
    const ref = { channelId: `dm-${userId}`, messageId: `m${++this.n}` };
    this.dms.push({ userId, msg, ref });
    return ref;
  }
  async edit(ref: MsgRef, msg: OutMessage): Promise<void> {
    this.edits.push({ ref, msg });
  }
  async sendLog(msg: LogMessage): Promise<void> {
    if (this.brokenLog) throw new Error('log down');
    if (this.logFailures > 0) {
      this.logFailures--;
      throw new Error('log hiccup');
    }
    this.logs.push(msg);
  }
  async archiveFile(file: { url: string; name: string }, caption: string): Promise<string> {
    if (this.brokenArchive) throw new Error('archive down');
    this.archived.push({ file, caption });
    return `https://discord.com/channels/${CFG.guildId}/${CFG.channels.log}/archive${this.archived.length}`;
  }
  dmsTo(userId: string) {
    return this.dms.filter((d) => d.userId === userId);
  }
  logText(): string {
    return this.logs.map((l) => l.text).join('\n');
  }
}

export class MemoryStore implements OfferStore {
  offerMap = new Map<string, { userId: string; ref: MsgRef }[]>();
  broken = false;
  async addOffer(t: string, userId: string, ref: MsgRef) {
    if (this.broken) throw new Error('redis down');
    this.offerMap.set(t, [...(this.offerMap.get(t) ?? []), { userId, ref }]);
  }
  async offers(t: string) {
    if (this.broken) throw new Error('redis down');
    return this.offerMap.get(t) ?? [];
  }
}

export const challenge = (target: ItemKey = 'gem') => ({
  target,
  options: [target, ...(['sword', 'key', 'bow', 'gem', 'ring'] as ItemKey[]).filter((k) => k !== target)].slice(0, 4),
});
