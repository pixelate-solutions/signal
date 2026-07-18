import { createHash } from "node:crypto";

import postgres from "postgres";

const databaseUrl = process.env["DATABASE_URL"];
if (databaseUrl === undefined) {
  throw new Error("DATABASE_URL is required");
}

const client = postgres(databaseUrl, { max: 1 });
const now = new Date().toISOString();

try {
  await client.begin(async (tx) => {
    await tx`
      insert into tenants (id, name) values ('ten_demo0001', 'Signal Demo')
      on conflict (id) do nothing
    `;
    await tx`
      insert into users (id, tenant_id, identity_provider_id, display_name, locale, timezone)
      values ('usr_demo0001', 'ten_demo0001', 'local|demo', 'Avery Demo', 'en-US', 'America/Detroit')
      on conflict (id) do nothing
    `;
    await tx`
      insert into memberships (tenant_id, user_id, role)
      values ('ten_demo0001', 'usr_demo0001', 'owner')
      on conflict do nothing
    `;
    await tx`
      insert into conversations (id, tenant_id, owner_user_id, title)
      values ('cnv_demo0001', 'ten_demo0001', 'usr_demo0001', 'Welcome to Signal')
      on conflict (id) do nothing
    `;
    await tx`
      insert into tool_definitions (id, tenant_id, data)
      values (
        'tool_demo_research',
        'ten_demo0001',
        ${tx.json({
          name: "demo.research",
          version: "1.0.0",
          risk: "R0",
          verification: "source_digest",
          seededAt: now,
        })}
      )
      on conflict (id) do nothing
    `;
    await tx`
      insert into connections (id, tenant_id, owner_user_id, provider, source, account_label, status, scopes)
      values (
        'con_demo0001',
        'ten_demo0001',
        'usr_demo0001',
        'signal_test_state',
        'native',
        'Verified local test provider',
        'ACTIVE',
        '["read","write"]'::jsonb
      )
      on conflict (id) do nothing
    `;
  });
  console.log(`Seed complete: ${createHash("sha256").update(now).digest("hex").slice(0, 12)}`);
} finally {
  await client.end();
}
