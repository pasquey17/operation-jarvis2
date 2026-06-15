/**
 * run-report-test.mjs — one-shot test: fetch + build the report package
 * for a given user over a 90-day window and dump the full JSON to stdout.
 *
 * Usage: node run-report-test.mjs
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Load .env before any Supabase calls (env vars are read lazily inside fn bodies)
const __dir = dirname(fileURLToPath(import.meta.url));
try {
  const envText = readFileSync(join(__dir, ".env"), "utf8");
  for (const line of envText.split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) {
      const val = m[2].trim().replace(/^["']|["']$/g, "");
      if (!process.env[m[1]]) process.env[m[1]] = val;
    }
  }
} catch {
  console.error("Warning: .env not found — relying on environment variables already set.");
}

import { fetchTradesForReport, buildReportPackage } from "./report-package.mjs";

// ledgy.legend@gmail.com resolves to this UUID in Supabase Auth.
// fetchAllTradesForAnalysis queries the trades table by auth_user_id (UUID),
// and journal_trades by user_id (email). Both are handled correctly once we
// pass the UUID here — the existing resolveUserEmail helper in analysis-engine
// picks up the email for the journal_trades side automatically.
const USER     = "cd5aaf81-5b6d-4bfd-90bf-5ec5ce96ee96"; // ledgy.legend@gmail.com
const DATE_TO  = "2025-10-10"; // last trade date (all trades are Jun–Oct 2025)
const DATE_FROM = "2025-07-12"; // 90 days prior
const BUCKET_DAYS = 7;          // weekly progression buckets

console.error(`\nFetching trades for ${USER}  (${DATE_FROM} → ${DATE_TO})…`);

const { periodTrades, allTimeTrades } = await fetchTradesForReport(USER, DATE_FROM, DATE_TO);

console.error(`Period: ${periodTrades.length} trades   |   All-time: ${allTimeTrades.length} trades\n`);

if (allTimeTrades.length === 0) {
  console.error("No trades found for this user. Check userId and Supabase connection.");
  process.exit(1);
}

const pkg = buildReportPackage(periodTrades, allTimeTrades, { bucketDays: BUCKET_DAYS });

// Full package to stdout as pretty JSON
console.log(JSON.stringify(pkg, null, 2));
