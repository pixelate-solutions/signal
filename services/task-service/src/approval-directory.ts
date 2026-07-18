import postgres from "postgres";

export type ApprovalDirectory = {
  eligibleApproverUserIds(tenantId: string, ownerUserId: string): Promise<readonly string[]>;
};

export class PostgresApprovalDirectory implements ApprovalDirectory {
  readonly #client: ReturnType<typeof postgres>;

  public constructor(databaseUrl: string) {
    this.#client = postgres(databaseUrl, {
      max: 4,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
    });
  }

  public async eligibleApproverUserIds(
    tenantId: string,
    ownerUserId: string,
  ): Promise<readonly string[]> {
    return this.#client.begin(async (transaction) => {
      await transaction`select set_config('app.tenant_id', ${tenantId}, true)`;
      const rows = await transaction<{ user_id: string }[]>`
        select memberships.user_id
        from memberships
        join users on users.id = memberships.user_id
        where memberships.tenant_id = ${tenantId}
          and memberships.role in ('owner', 'administrator')
          and users.status = 'active'
        order by case when memberships.user_id = ${ownerUserId} then 0 else 1 end,
                 memberships.created_at,
                 memberships.user_id
      `;
      const ids = rows.map((row) => row.user_id);
      return ids.includes(ownerUserId) ? ids : [ownerUserId, ...ids];
    });
  }

  public async close(): Promise<void> {
    await this.#client.end({ timeout: 5 });
  }
}
