#!/usr/bin/env node
// Exports Jin's restaurant list from Supabase to dining.json + dining.md
// Mirrors the cellar pipeline (export-cellar.mjs).
// Env vars: SUPABASE_URL, SUPABASE_KEY (publishable, read-only)
//
// Only whitelisted columns are fetched. `notes` and all internal/heavy
// columns (ids, photo URLs, timestamps, enrichment flags) are never requested,
// so private/heavy data cannot leak into the public file.

const URL = process.env.SUPABASE_URL || "https://dunebdadsixnpufqnsss.supabase.co";
const KEY = process.env.SUPABASE_KEY || "";

const COLUMNS = [
  "name", "cuisine", "country", "city", "area", "rating", "status",
  "michelin_type", "michelin_stars", "michelin_verified",
  "google_rating", "price_level", "favourite",
];

async function getAll(table) {
  // Page through PostgREST so we are not capped at the default 1000-row limit.
  const pageSize = 1000;
  let from = 0, out = [];
  for (;;) {
    const r = await fetch(`${URL}/rest/v1/${table}?select=${COLUMNS.join(",")}`, {
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        Range: `${from}-${from + pageSize - 1}`,
      },
    });
    if (!r.ok) throw new Error(`${table} -> ${r.status} ${await r.text()}`);
    const batch = await r.json();
    out = out.concat(batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

// ---- helpers -------------------------------------------------------------
const truthy = v => v === true || v === "true" || v === 1 || v === "1";
const ratingNum = r => {
  if (r.rating == null || r.rating === "") return null;
  const n = Number(r.rating);
  return Number.isFinite(n) ? n : null;
};
const isSG = r => (r.country || "").trim().toLowerCase() === "singapore";

function michelin(r) {
  const stars = Number(r.michelin_stars) || 0;
  const type = (r.michelin_type || "").toLowerCase();
  if (truthy(r.michelin_verified) && stars > 0) return "★".repeat(stars);
  if (type.includes("bib")) return "Bib";
  return "";
}

// `Name ★ ♥ — cuisine — rating`; closed rows italicised + [closed]; want-to-try
// rows have no rating so the trailing score is omitted.
function entry(r) {
  const markers = [michelin(r), truthy(r.favourite) ? "♥" : ""].filter(Boolean).join(" ");
  const rt = ratingNum(r);
  const score = rt != null ? ` — ${rt}` : "";
  const cuisine = r.cuisine ? ` — ${r.cuisine}` : " — ";
  const closed = (r.status || "") === "closed";
  if (closed) {
    return `- *${r.name} [closed]${markers ? " " + markers : ""}${cuisine}${score}*`;
  }
  return `- **${r.name}**${markers ? " " + markers : ""}${cuisine}${score}`;
}

// rating desc, then name asc
const byRating = (a, b) => (ratingNum(b) ?? -1) - (ratingNum(a) ?? -1) ||
  String(a.name).localeCompare(String(b.name));

function groupBy(rows, keyFn) {
  const m = new Map();
  rows.forEach(r => {
    const k = keyFn(r) || "—";
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  });
  return m;
}

// Order groups by their best rating (best area/city first), tie-break by name.
function orderedGroups(map) {
  return [...map.entries()].sort((a, b) => {
    const ba = Math.max(...a[1].map(r => ratingNum(r) ?? -1));
    const bb = Math.max(...b[1].map(r => ratingNum(r) ?? -1));
    return bb - ba || String(a[0]).localeCompare(String(b[0]));
  });
}

// ---- build ---------------------------------------------------------------
export function buildOutputs(rows) {
  const all = rows || [];
  const visited = all.filter(r => (r.status || "") === "visited");
  const wantToTry = all.filter(r => (r.status || "") === "want-to-try");
  const closed = all.filter(r => (r.status || "") === "closed");
  // Location sections show places you've been to (visited + closed); want-to-try
  // has its own section.
  const placed = all.filter(r => (r.status || "") !== "want-to-try");

  const ratedVals = visited.map(ratingNum).filter(n => n != null);
  const avg = ratedVals.length
    ? Math.round((ratedVals.reduce((s, n) => s + n, 0) / ratedVals.length) * 10) / 10
    : 0;

  const date = new Date().toISOString().slice(0, 10);

  // ---- JSON (structured mirror, for programmatic use / backup) ----
  const json = {
    generated_at: new Date().toISOString(),
    source: "Supabase (restaurants)",
    summary: {
      visited: visited.length,
      want_to_try: wantToTry.length,
      avg_rating: avg,
      total: all.length,
    },
    restaurants: all.map(r => ({
      name: r.name, cuisine: r.cuisine, country: r.country, city: r.city,
      area: r.area, rating: ratingNum(r), status: r.status,
      michelin_type: r.michelin_type || null,
      michelin_stars: Number(r.michelin_stars) || 0,
      michelin_verified: truthy(r.michelin_verified),
      google_rating: r.google_rating != null && r.google_rating !== "" ? Number(r.google_rating) : null,
      price_level: r.price_level || null,
      favourite: truthy(r.favourite),
    })),
  };

  // ---- Markdown ----
  let md = `# Jin's Dining List — snapshot ${date}\n\n`;
  md += `_Auto-exported from Supabase, refreshed nightly. ${visited.length} visited · ${wantToTry.length} to try · ${avg} avg · ${all.length} total._\n\n`;
  md += `Legend: **My /10** = personal score · ★/★★/★★★ = Michelin stars · ♥ = would return / favourite · [closed] = permanently closed.\n\n`;

  // Favourites
  const favs = all.filter(r => truthy(r.favourite));
  if (favs.length) {
    md += `## Favourites (${favs.length})\n\n`;
    const fSG = favs.filter(isSG).sort(byRating);
    const fOS = favs.filter(r => !isSG(r)).sort(byRating);
    if (fSG.length) {
      md += `### Singapore\n\n`;
      fSG.forEach(r => { md += entry(r) + "\n"; });
      md += `\n`;
    }
    if (fOS.length) {
      md += `### Overseas\n\n`;
      fOS.forEach(r => { md += entry(r) + "\n"; });
      md += `\n`;
    }
  }

  // Singapore — by area
  const sgPlaced = placed.filter(isSG);
  if (sgPlaced.length) {
    md += `## Singapore — by area\n\n`;
    orderedGroups(groupBy(sgPlaced, r => r.area)).forEach(([area, list]) => {
      md += `### ${area}\n\n`;
      list.sort(byRating).forEach(r => { md += entry(r) + "\n"; });
      md += `\n`;
    });
  }

  // Overseas — by city
  const osPlaced = placed.filter(r => !isSG(r));
  if (osPlaced.length) {
    md += `## Overseas — by city\n\n`;
    orderedGroups(groupBy(osPlaced, r => r.city || r.country)).forEach(([city, list]) => {
      md += `### ${city}\n\n`;
      list.sort(byRating).forEach(r => { md += entry(r) + "\n"; });
      md += `\n`;
    });
  }

  // Want to try
  if (wantToTry.length) {
    md += `## Want to try (${wantToTry.length})\n\n`;
    const wSG = wantToTry.filter(isSG).sort(byRating);
    const wOS = wantToTry.filter(r => !isSG(r)).sort(byRating);
    if (wSG.length) {
      md += `### Singapore\n\n`;
      wSG.forEach(r => { md += entry(r) + "\n"; });
      md += `\n`;
    }
    if (wOS.length) {
      md += `### Overseas\n\n`;
      wOS.forEach(r => { md += entry(r) + "\n"; });
      md += `\n`;
    }
  }

  // Top rated (>= 9.0)
  const top = all.filter(r => (ratingNum(r) ?? 0) >= 9.0).sort(byRating);
  if (top.length) {
    md += `## Top rated (9.0+)\n\n`;
    md += `| My /10 | Restaurant | Cuisine | Where |\n|---|---|---|---|\n`;
    top.forEach(r => {
      const where = isSG(r) ? (r.area || "Singapore") : (r.city || r.country || "");
      const mk = michelin(r);
      md += `| ${ratingNum(r)} | ${r.name}${mk ? " " + mk : ""}${truthy(r.favourite) ? " ♥" : ""} | ${r.cuisine || ""} | ${where} |\n`;
    });
    md += `\n`;
  }

  return { json: JSON.stringify(json, null, 2), md };
}

async function main() {
  if (!KEY) throw new Error("SUPABASE_KEY env var required");
  const rows = await getAll("restaurants");
  const { json, md } = buildOutputs(rows);
  const fs = await import("node:fs");
  fs.writeFileSync("dining.json", json);
  fs.writeFileSync("dining.md", md);
  console.log(`Wrote dining.json and dining.md (${rows.length} restaurants)`);
}

import { fileURLToPath } from "node:url";
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e); process.exit(1); });
