import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required to set up roles");
}

const sql = postgres(connectionString, { max: 1 });

async function main() {
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
        CREATE ROLE app_user LOGIN PASSWORD 'AppUser2026DbAccessBlanify';
      END IF;
    END
    $$;
  `;
  await sql`GRANT USAGE ON SCHEMA public TO app_user`;
  await sql`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO app_user`;
  await sql`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO app_user`;
  console.log("app_user role ready");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
