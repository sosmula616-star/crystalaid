import Fastify from 'fastify';

export interface FakeUser {
  id: string;
  username: string;
  avatar: string | null;
}

export interface FakeInstance {
  location: { id: string; kind: string; channel_id?: string; guild_id?: string };
  users: string[];
}

export interface RecordedRequest {
  method: string;
  url: string;
  authorization: string | undefined;
  userAgent: string | undefined;
  body: unknown;
}

export interface FakeDiscord {
  /** Base URL to use as DISCORD_API_URL. */
  url: string;
  requests: RecordedRequest[];
  /** OAuth code -> access token the code exchanges for. */
  codes: Map<string, string>;
  /** Access token -> user returned by /users/@me. */
  tokens: Map<string, FakeUser>;
  instances: Map<string, FakeInstance>;
  /** `${guildId}:${userId}` -> role ids. A missing entry answers 404. */
  members: Map<string, string[]>;
  /** Every request whose URL contains `match` answers with `status` and an empty body. */
  failWith(match: string, status: number): void;
  clearFailures(): void;
  /** Registers a complete working login and returns its credentials. */
  addLogin(opts: {
    code: string;
    user: FakeUser;
    instanceId: string;
    guildId: string | null;
    kind?: string;
    instanceUsers?: string[];
    roles?: string[] | null;
  }): void;
  close(): Promise<void>;
}

/** A stand-in for the Discord REST API on a random local port. */
export async function startFakeDiscord(botToken: string, applicationId: string): Promise<FakeDiscord> {
  const app = Fastify();
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });

  const failures: [string, number][] = [];
  const fake: FakeDiscord = {
    url: '',
    requests: [],
    codes: new Map(),
    tokens: new Map(),
    instances: new Map(),
    members: new Map(),
    failWith: (match, status) => void failures.push([match, status]),
    clearFailures: () => void (failures.length = 0),
    addLogin({ code, user, instanceId, guildId, kind = 'gc', instanceUsers, roles }) {
      const token = `access-${code}`;
      fake.codes.set(code, token);
      fake.tokens.set(token, user);
      fake.instances.set(instanceId, {
        location: { id: 'loc-1', kind, ...(guildId ? { channel_id: 'chan-1', guild_id: guildId } : {}) },
        users: instanceUsers ?? [user.id],
      });
      if (guildId && roles) fake.members.set(`${guildId}:${user.id}`, roles);
    },
    close: () => app.close(),
  };

  app.addHook('onRequest', async (request, reply) => {
    fake.requests.push({
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization,
      userAgent: request.headers['user-agent'],
      body: undefined,
    });
    const hit = failures.find(([match]) => request.url.includes(match));
    if (hit) return reply.status(hit[1]).send();
  });
  app.addHook('preHandler', async (request) => {
    const last = fake.requests[fake.requests.length - 1];
    if (last) last.body = request.body;
  });

  app.post('/oauth2/token', async (request, reply) => {
    const body = request.body as Record<string, string>;
    const token = fake.codes.get(body.code ?? '');
    if (!token) return reply.status(400).send({ error: 'invalid_grant' });
    return { access_token: token, token_type: 'Bearer', expires_in: 604800, scope: 'identify guilds' };
  });

  app.get('/users/@me', async (request, reply) => {
    const bearer = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1];
    const user = bearer ? fake.tokens.get(bearer) : undefined;
    if (!user) return reply.status(401).send({ message: '401: Unauthorized' });
    return user;
  });

  app.get<{ Params: { app: string; id: string } }>(
    '/applications/:app/activity-instances/:id',
    async (request, reply) => {
      if (request.headers.authorization !== `Bot ${botToken}` || request.params.app !== applicationId) {
        return reply.status(401).send({ message: '401: Unauthorized' });
      }
      const instance = fake.instances.get(request.params.id);
      if (!instance) return reply.status(404).send({ message: 'Unknown Application Instance' });
      return {
        application_id: applicationId,
        instance_id: request.params.id,
        launch_id: 'launch-1',
        location: instance.location,
        users: instance.users,
      };
    },
  );

  app.get<{ Params: { guild: string; user: string } }>(
    '/guilds/:guild/members/:user',
    async (request, reply) => {
      if (request.headers.authorization !== `Bot ${botToken}`) {
        return reply.status(401).send({ message: '401: Unauthorized' });
      }
      const roles = fake.members.get(`${request.params.guild}:${request.params.user}`);
      if (!roles) return reply.status(404).send({ message: 'Unknown Member' });
      return { roles, user: { id: request.params.user } };
    },
  );

  fake.url = await app.listen({ port: 0, host: '127.0.0.1' });
  return fake;
}
