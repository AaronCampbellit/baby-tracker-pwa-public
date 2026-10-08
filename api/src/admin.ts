import { randomUUID } from "node:crypto";
import { pool, migrate, transaction } from "./db.ts";
import { token, hash } from "./auth.ts";
await migrate();
const [command, ...args] = process.argv.slice(2);
if (command === "create-family") {
  const name = args.join(" ").trim();
  if (!name)
    throw new Error("Usage: node src/admin.ts create-family Household name");
  const id = randomUUID(),
    invite = token();
  await transaction(async (c) => {
    await c.query("INSERT INTO families(id,name) VALUES($1,$2)", [id, name]);
    await c.query(
      "INSERT INTO invitations VALUES($1,$2,'owner',now()+interval '7 days',NULL)",
      [hash(invite), id],
    );
  });
  console.log(
    JSON.stringify(
      {
        familyId: id,
        activationUrl: `${process.env.APP_ORIGIN ?? "http://localhost:4174"}/?invite=${invite}`,
      },
      null,
      2,
    ),
  );
} else if (command === "reset-password") {
  // Administrator provides a time-limited invitation-style reset token, never a password.
  const email = args[0]?.toLowerCase();
  const t = token();
  const q = await pool.query(
    "INSERT INTO password_resets(token_hash,user_id,expires_at) SELECT $1,id,now()+interval '1 hour' FROM users WHERE email=$2 RETURNING user_id",
    [hash(t), email],
  );
  if (!q.rowCount) throw new Error("Account not found");
  console.log(
    `${process.env.APP_ORIGIN ?? "http://localhost:4174"}/?reset=${t}`,
  );
} else throw new Error("Commands: create-family, reset-password");
await pool.end();
