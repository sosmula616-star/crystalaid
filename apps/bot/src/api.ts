import {
  ActiveTicketResponse,
  ClaimResponse,
  CloseResponse,
  CreateTicketResponse,
  DiagnosticsResponse,
  DueTicketsResponse,
  MenuAccessResponse,
  OpenTicketsResponse,
  PermissionsResponse,
  PtListResponse,
  SettingsSchema,
  MessageResponse,
  PtRemindersResponse,
  type ClaimRequest,
  type CreateTicketRequest,
  type Settings,
  type SettingsPatch,
} from '@crystalaid/contracts';
import type { Permission } from '@crystalaid/domain';
import type { z } from 'zod';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly reason: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type ActiveTicket = z.infer<typeof ActiveTicketResponse>['ticket'];

/** Calls `/internal/*` with the service token. Errors keep the API's code and reason. */
export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call<T>(
    method: string,
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
    query?: Record<string, string>,
  ): Promise<T> {
    const url = new URL(path, this.baseUrl);
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
    const res = await this.fetchImpl(url, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    if (!res.ok) {
      const e = (json as { error?: { code?: string; reason?: string; message?: string } } | undefined)?.error;
      throw new ApiError(res.status, e?.code ?? 'UNKNOWN', e?.reason, e?.message ?? `HTTP ${res.status}`);
    }
    return schema.parse(json);
  }

  createTicket(req: CreateTicketRequest): Promise<CreateTicketResponse> {
    return this.call('POST', '/internal/tickets', CreateTicketResponse, req);
  }
  claim(ticketId: string, actorDiscordId: string, choiceIndex: number): Promise<ClaimResponse> {
    const body: ClaimRequest = { actorDiscordId, choiceIndex };
    return this.call('POST', `/internal/tickets/${ticketId}/claim`, ClaimResponse, body);
  }
  addMessage(ticketId: string, actorDiscordId: string, content: string, discordMessageId?: string) {
    return this.call('POST', `/internal/tickets/${ticketId}/messages`, MessageResponse, {
      actorDiscordId,
      content,
      ...(discordMessageId ? { discordMessageId } : {}),
    });
  }
  close(ticketId: string, actorDiscordId: string): Promise<CloseResponse> {
    return this.call('POST', `/internal/tickets/${ticketId}/close`, CloseResponse, { actorDiscordId });
  }
  async rate(ticketId: string, actorDiscordId: string, rating: number): Promise<void> {
    await this.call('POST', `/internal/tickets/${ticketId}/rating`, passthrough, { actorDiscordId, rating });
  }
  async active(actorDiscordId: string): Promise<ActiveTicket> {
    return (await this.call('GET', '/internal/tickets/active', ActiveTicketResponse, undefined, { actorDiscordId }))
      .ticket;
  }
  due(): Promise<DueTicketsResponse> {
    return this.call('GET', '/internal/tickets/due', DueTicketsResponse);
  }
  reminders(): Promise<PtRemindersResponse> {
    return this.call('GET', '/internal/pt/reminders', PtRemindersResponse);
  }
  // ---------- menus: the API checks the level of `actorDiscordId` on each of these ----------

  menuAccess(actorDiscordId: string): Promise<MenuAccessResponse> {
    return this.call('GET', '/internal/menu/access', MenuAccessResponse, undefined, { actorDiscordId });
  }
  ptList(actorDiscordId: string, date: string): Promise<z.infer<typeof PtListResponse>> {
    return this.call('GET', '/internal/pt', PtListResponse, undefined, { actorDiscordId, date });
  }
  async ptSet(actorDiscordId: string, startsAt: string, discordUserId: string): Promise<void> {
    await this.call('PUT', '/internal/pt', passthrough, { actorDiscordId, startsAt, discordUserId });
  }
  async ptRemove(actorDiscordId: string, startsAt: string, discordUserId: string): Promise<void> {
    await this.call('DELETE', '/internal/pt', passthrough, undefined, { actorDiscordId, startsAt, discordUserId });
  }
  settings(actorDiscordId: string): Promise<Settings> {
    return this.call('GET', '/internal/menu/settings', SettingsSchema, undefined, { actorDiscordId });
  }
  patchSettings(actorDiscordId: string, patch: SettingsPatch): Promise<Settings> {
    return this.call('PATCH', '/internal/menu/settings', SettingsSchema, { actorDiscordId, patch });
  }
  permissions(actorDiscordId: string): Promise<PermissionsResponse> {
    return this.call('GET', '/internal/permissions', PermissionsResponse, undefined, { actorDiscordId });
  }
  patchPermissions(actorDiscordId: string, level: 'SUPPORT' | 'CURATOR', grants: Permission[]) {
    return this.call('PATCH', '/internal/permissions', PermissionsResponse, { actorDiscordId, level, grants });
  }
  openTickets(actorDiscordId: string): Promise<OpenTicketsResponse> {
    return this.call('GET', '/internal/tickets/open', OpenTicketsResponse, undefined, { actorDiscordId });
  }
  diagnostics(actorDiscordId: string): Promise<DiagnosticsResponse> {
    return this.call('GET', '/internal/diagnostics', DiagnosticsResponse, undefined, { actorDiscordId });
  }
}

const passthrough = { parse: (v: unknown) => v } as unknown as z.ZodType<unknown>;
