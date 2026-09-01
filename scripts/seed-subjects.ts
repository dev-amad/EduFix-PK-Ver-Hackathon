import { Client } from "pg";
import { loadEnvFile } from "./lib/load-env";

loadEnvFile();

const SUBJECTS = [
  { id: "pak-studies", name: "Pakistan Studies", code: "2059" },
  { id: "islamiyat", name: "Islamiyat", code: "2058" },
  { id: "urdu", name: "Urdu - Second Language", code: "3248" },
];

async function main() {
  const connectionString = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("Missing SUPABASE_DB_URL in .env.local");
    process.exit(1);
  }

  const client = new Client({ connectionString });
  await client.connect();

  for (const subject of SUBJECTS) {
    await client.query(
      `INSERT INTO subjects (id, name, code)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, code = EXCLUDED.code`,
      [subject.id, subject.name, subject.code]
    );
    console.log(`Upserted: ${subject.id} (${subject.name}, code ${subject.code})`);
  }

  const { rows } = await client.query(
    "SELECT id, name, code FROM subjects ORDER BY id"
  );
  console.log("\nsubjects table now contains:");
  for (const row of rows) {
    console.log(`  ${row.id.padEnd(12)} ${row.name.padEnd(24)} ${row.code}`);
  }

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
