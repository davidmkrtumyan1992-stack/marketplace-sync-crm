/**
 * Скрипт создания первого администратора CRM.
 * Запуск: npx tsx scripts/create-admin.ts --login admin --password <пароль>
 */
import { scrypt, randomBytes } from "crypto";
import { promisify } from "util";
import { Pool } from "pg";

const scryptAsync = promisify(scrypt);

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

async function main() {
  const args = process.argv.slice(2);
  const loginIdx = args.indexOf("--login");
  const passwordIdx = args.indexOf("--password");

  if (loginIdx === -1 || passwordIdx === -1) {
    console.error("Использование: npx tsx scripts/create-admin.ts --login <логин> --password <пароль>");
    process.exit(1);
  }

  const login = args[loginIdx + 1];
  const password = args[passwordIdx + 1];

  if (!login || !password) {
    console.error("Логин и пароль не могут быть пустыми");
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL не задан");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const passwordHash = await hashPassword(password);

    const { rows: existing } = await pool.query(
      "SELECT id FROM users WHERE login = $1",
      [login]
    );

    if (existing.length > 0) {
      await pool.query(
        "UPDATE users SET password_hash = $1, updated_at = NOW() WHERE login = $2",
        [passwordHash, login]
      );
      console.log(`✓ Пароль пользователя «${login}» обновлён`);
    } else {
      const { rows } = await pool.query(
        `INSERT INTO users (login, password_hash, first_name, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())
         RETURNING id`,
        [login, passwordHash, "Admin"]
      );
      const userId = rows[0].id;

      // Создать запись в user_roles (owner)
      await pool.query(
        `INSERT INTO user_roles (user_id, organization_id, role, created_at)
         VALUES ($1, $1, 'owner', NOW())
         ON CONFLICT DO NOTHING`,
        [userId]
      );

      console.log(`✓ Администратор «${login}» создан (id: ${userId})`);
    }
  } catch (e: any) {
    console.error("Ошибка:", e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
