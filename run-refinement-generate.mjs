/**
 * Test script: generate a Refinements report for Aiden's account and save output.
 *
 * Usage:
 *   node --env-file=.env run-refinement-generate.mjs
 *
 * Outputs:
 *   - Plan JSON to stdout
 *   - Full HTML to refinement-output.html
 */

import fs from "node:fs";
import { fetchTradesForReport, buildReportPackage } from "./report-package.mjs";
import { planRefinementStep, writeRefinementStream } from "./refinement-generator.mjs";

const USER_ID = "e7b15ce6-13d2-488c-87f6-02eccb326641"; // aidenpasque11@gmail.com

async function main() {
  const now = new Date();
  const dateTo   = now.toISOString().slice(0, 10);
  const dateFrom = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  console.log(`\n[test] Fetching trades for ${USER_ID} (${dateFrom} → ${dateTo})…`);
  const { periodTrades, allTimeTrades } = await fetchTradesForReport(USER_ID, dateFrom, dateTo);
  console.log(`[test] periodTrades=${periodTrades.length}  allTimeTrades=${allTimeTrades.length}`);

  if (allTimeTrades.length === 0) {
    console.error("[test] No trades found — check user_id and Supabase connection.");
    process.exit(1);
  }

  const pkg = buildReportPackage(periodTrades, allTimeTrades, { bucketDays: 30 });
  console.log(`[test] Package: obs=${pkg.observations?.length ?? 0}  customPatterns=${pkg.customFieldPatterns?.length ?? 0}`);

  console.log("\n[test] Step 1: Planning (Haiku)…");
  const { filteredPkg, plan } = await planRefinementStep(pkg);

  console.log("\n──────────────────── PLAN JSON ────────────────────");
  console.log(JSON.stringify(plan, null, 2));
  console.log("───────────────────────────────────────────────────\n");

  console.log("[test] Step 2: Writing (Sonnet streaming)…");
  const chunks = [];
  let charCount = 0;
  for await (const chunk of writeRefinementStream(filteredPkg, plan)) {
    process.stdout.write(".");
    chunks.push(chunk);
    charCount += chunk.length;
  }
  console.log(`\n[test] Streamed ${charCount} chars across ${chunks.length} chunks.`);

  const html = chunks.join("");
  const outPath = new URL("./refinement-output.html", import.meta.url).pathname
    .replace(/^\/([A-Z]:)/, "$1")
    .replace(/%20/g, " ");
  fs.writeFileSync(outPath, html, "utf8");
  console.log(`[test] Saved → ${outPath}`);
  console.log("[test] Open refinement-output.html in a browser to review the report.");
}

main().catch((e) => {
  console.error("[test] Fatal:", e);
  process.exit(1);
});
