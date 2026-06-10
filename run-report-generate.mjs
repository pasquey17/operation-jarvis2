/**
 * run-report-generate.mjs — generate and save an HTML report for ledgy.legend@gmail.com
 * over the 90-day window matching their actual trade data (2025-07-12 → 2025-10-10).
 *
 * Usage: node --env-file=.env run-report-generate.mjs
 */
import { writeFileSync } from "fs";
import { fetchTradesForReport, buildReportPackage } from "./report-package.mjs";
import { generateReport } from "./report-generator.mjs";

const USER       = "cd5aaf81-5b6d-4bfd-90bf-5ec5ce96ee96"; // ledgy.legend@gmail.com
const DATE_FROM  = "2025-07-12";
const DATE_TO    = "2025-10-10";
const BUCKET_DAYS = 30;   // monthly buckets for a quarter window
const WINDOW_LABEL = "90-day (quarter)";
const OUT_FILE   = "report-output.html";

console.error("Fetching trades…");
const { periodTrades, allTimeTrades } = await fetchTradesForReport(USER, DATE_FROM, DATE_TO);
console.error(`Period: ${periodTrades.length}  |  All-time: ${allTimeTrades.length}`);

console.error("Building data package…");
const pkg = buildReportPackage(periodTrades, allTimeTrades, { bucketDays: BUCKET_DAYS });

console.error("Step 1: Planning…");
console.error("Step 2: Writing (this takes ~30s)…");
const html = await generateReport(pkg, WINDOW_LABEL);

writeFileSync(OUT_FILE, html, "utf8");
console.error(`\nReport saved → ${OUT_FILE}  (${html.length.toLocaleString()} chars)`);

// Also dump to stdout so the tool captures it
console.log(html);
