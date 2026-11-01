import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { seedDefaults } from '@crystalaid/database';
import { syncMember } from '../../services/staff.js';
import { withApp, type AppContext } from '../../testing/harness.js';
import {
  ADMIN_ROLE,
  CURATOR_ROLE,
  SERVICE_TOKEN,
  SUPPORT_ROLE,
  clearOwnedKeys,
  config,
  discordId,
  memberInput,
  testRedis,
} from '../../test-helpers.js';

const redis = testRedis();
beforeEach(() => clearOwnedKeys(redis));
afterAll(() => redis.quit());

const call = (ctx: AppContext, method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH', url: string, payload?: object) =>
  ctx.app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${SERVICE_TOKEN}` },
    ...(payload ? { payload } : {}),
  });

const HOUR = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000);

describe('/internal ticket and PT routes', () => {
  it('require the service token', () =>
    withApp({ redis }, async (ctx) => {
      for (const [m, u] of [
        ['GET', '/internal/pt/reminders'],
        ['GET', '/internal/tickets/due'],
        ['POST', '/internal/tickets'],
      ] as const) {
        expect((await ctx.app.inject({ method: m, url: u })).statusCode).toBe(401);
      }
    }));

  it('check the level of the acting person on every request', () =>
    withApp({ redis }, async (ctx) => {
      const deps = { db: ctx.db, config };
      await seedDefaults(ctx.db, config.guildId);
      await syncMember(deps, memberInput(1, [ADMIN_ROLE]));
      await syncMember(deps, memberInput(2, [SUPPORT_ROLE]));
      await syncMember(deps, memberInput(3, [SUPPORT_ROLE, CURATOR_ROLE]));
      const body = { startsAt: HOUR.toISOString(), discordUserId: discordId(2) };

      expect((await call(ctx, 'PUT', '/internal/pt', { ...body, actorDiscordId: discordId(2) })).statusCode).toBe(403);
      expect((await call(ctx, 'PUT', '/internal/pt', { ...body, actorDiscordId: discordId(99) })).statusCode).toBe(403);
      expect((await call(ctx, 'PUT', '/internal/pt', { ...body, actorDiscordId: discordId(3) })).statusCode).toBe(200);
      const list = await call(
        ctx,
        'GET',
        `/internal/pt?actorDiscordId=${discordId(3)}&date=${HOUR.toISOString().slice(0, 10)}`,
      );
      expect(list.statusCode).toBe(200);

      expect((await call(ctx, 'GET', `/internal/menu/settings?actorDiscordId=${discordId(3)}`)).statusCode).toBe(403);
      expect((await call(ctx, 'GET', `/internal/menu/settings?actorDiscordId=${discordId(1)}`)).statusCode).toBe(200);
      expect((await call(ctx, 'GET', `/internal/diagnostics?actorDiscordId=${discordId(1)}`)).statusCode).toBe(403);
    }));

  it('run a ticket from creation to rating without ever sending the answer', () =>
    withApp({ redis }, async (ctx) => {
      const deps = { db: ctx.db, config };
      await syncMember(deps, memberInput(1, [ADMIN_ROLE]));
      await syncMember(deps, memberInput(2, [SUPPORT_ROLE]));
      const put = await call(ctx, 'PUT', '/internal/pt', {
        actorDiscordId: discordId(1),
        startsAt: HOUR.toISOString(),
        discordUserId: discordId(2),
      });
      expect(put.statusCode).toBe(200);

      const created = await call(ctx, 'POST', '/internal/tickets', {
        actorDiscordId: discordId(50),
        username: 'asker',
        message: 'question',
      });
      expect(created.statusCode).toBe(200);
      expect(created.body).not.toContain('answer');
      const { ticketId, challenges } = created.json() as {
        ticketId: string;
        challenges: { supportDiscordId: string; challenge: { target: string } }[];
      };
      expect(challenges).toHaveLength(1);

      const tooLong = await call(ctx, 'POST', '/internal/tickets', {
        actorDiscordId: discordId(51),
        username: 'x',
        message: 'x'.repeat(301),
      });
      expect(tooLong.statusCode).toBe(400);

      const asRequester = await call(ctx, 'POST', `/internal/tickets/${ticketId}/claim`, {
        actorDiscordId: discordId(50),
        choice: challenges[0]!.challenge.target,
      });
      expect(asRequester.statusCode).toBe(403);
      const claim = await call(ctx, 'POST', `/internal/tickets/${ticketId}/claim`, {
        actorDiscordId: discordId(2),
        choice: challenges[0]!.challenge.target,
      });
      expect(claim.json()).toMatchObject({ result: 'claimed' });

      const reply = await call(ctx, 'POST', `/internal/tickets/${ticketId}/messages`, {
        actorDiscordId: discordId(2),
        content: 'hello',
      });
      expect(reply.json()).toMatchObject({ isStaff: true, recipientDiscordId: discordId(50) });
      const active = await call(ctx, 'GET', `/internal/tickets/active?actorDiscordId=${discordId(50)}`);
      expect(active.json()).toMatchObject({ ticket: { ticketId, role: 'requester' } });

      const closed = await call(ctx, 'POST', `/internal/tickets/${ticketId}/close`, { actorDiscordId: discordId(2) });
      expect(closed.json().transcript).toContain('hello');
      const rated = await call(ctx, 'POST', `/internal/tickets/${ticketId}/rating`, {
        actorDiscordId: discordId(50),
        rating: 5,
      });
      expect(rated.statusCode).toBe(200);
      expect(
        (await call(ctx, 'POST', `/internal/tickets/${ticketId}/rating`, { actorDiscordId: discordId(50), rating: 5 }))
          .statusCode,
      ).toBe(409);
    }));
});
