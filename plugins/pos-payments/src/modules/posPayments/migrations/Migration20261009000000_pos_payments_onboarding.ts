import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/** 4 tabelas do onboarding (onboarding.md §5.2). Roda SÓ com `medusa
 * db:migrate` explícito no deploy — não executa no medusa start. */
export class Migration20261009000000 extends Migration {
  override async up(): Promise<void> {
    const k = this.getKnex()
    await k.schema.createTable("pos_payments_connection", (t) => {
      t.string("id").primary()
      t.string("acquirer").notNullable().unique()
      t.string("status").notNullable()
      t.string("action_reason").nullable()
      t.jsonb("external_refs").nullable()
      t.timestamp("expires_at", { useTz: true }).nullable()
      t.timestamp("last_validated_at", { useTz: true }).nullable()
      t.string("created_by").nullable()
      t.string("updated_by").nullable()
      t.timestamp("created_at", { useTz: true }).nullable()
      t.timestamp("updated_at", { useTz: true }).nullable()
      t.timestamp("deleted_at", { useTz: true }).nullable()
    })
    await k.schema.createTable("pos_payments_credential", (t) => {
      t.string("id").primary()
      t.string("connection_id").notNullable().unique()
      t.text("payload").notNullable()
      t.timestamp("created_at", { useTz: true }).nullable()
      t.timestamp("updated_at", { useTz: true }).nullable()
      t.timestamp("deleted_at", { useTz: true }).nullable()
    })
    await k.schema.createTable("pos_payments_oauth_state", (t) => {
      t.string("id").primary()
      t.string("state").notNullable().unique()
      t.string("acquirer").notNullable()
      t.string("actor_id").nullable()
      t.timestamp("expires_at", { useTz: true }).notNullable()
      t.timestamp("used_at", { useTz: true }).nullable()
      t.timestamp("created_at", { useTz: true }).nullable()
      t.timestamp("updated_at", { useTz: true }).nullable()
      t.timestamp("deleted_at", { useTz: true }).nullable()
    })
    await k.schema.createTable("pos_payments_audit_event", (t) => {
      t.string("id").primary()
      t.string("event").notNullable()
      t.string("acquirer").nullable()
      t.string("actor_id").nullable()
      t.jsonb("payload").nullable()
      t.timestamp("created_at", { useTz: true }).nullable()
      t.timestamp("updated_at", { useTz: true }).nullable()
      t.timestamp("deleted_at", { useTz: true }).nullable()
    })
  }

  override async down(): Promise<void> {
    const k = this.getKnex()
    await k.schema.dropTableIfExists("pos_payments_audit_event")
    await k.schema.dropTableIfExists("pos_payments_oauth_state")
    await k.schema.dropTableIfExists("pos_payments_credential")
    await k.schema.dropTableIfExists("pos_payments_connection")
  }
}
