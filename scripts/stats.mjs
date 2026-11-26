// Builds three cards from public + private data:
//   assets/stats.svg      account age, all-time contributions and commits, repos, app downloads
//   assets/languages.svg  most-used languages across your own (non-fork) repos
//   assets/years.svg      contributions for each year since joining
// Runs in GitHub Actions with METRICS_TOKEN (classic PAT: repo + read:user).
// Set MOCK=1 to render with sample data and no network.
import { writeFileSync, mkdirSync } from "node:fs";

const LOGIN = "madhwendrashukla";
const APP_DOWNLOADS = "60K+"; // Play Store total, update by hand when it grows
const OUT = process.env.OUT || "assets/stats.svg";
const LANG_OUT = process.env.LANG_OUT || "assets/languages.svg";
const YEARS_OUT = process.env.YEARS_OUT || "assets/years.svg";
const LANG_LIMIT = 8;
// Markup, styling and build files that would crowd out real programming languages
const LANG_IGNORE = new Set(["HTML", "CSS", "SCSS", "Makefile", "Dockerfile", "Shell", "Batchfile", "CMake", "Procfile"]);

async function gql(query) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${process.env.METRICS_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": `${LOGIN}-profile-stats`,
    },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(JSON.stringify(json.errors || json));
  return json.data;
}

async function fetchStats() {
  const base = await gql(`{
    user(login: "${LOGIN}") {
      createdAt
      contributionsCollection { contributionYears }
      repositories(ownerAffiliations: OWNER) { totalCount }
    }
  }`);
  const u = base.user;
  const years = u.contributionsCollection.contributionYears;
  const parts = years
    .map(
      (y) => `y${y}: contributionsCollection(from: "${y}-01-01T00:00:00Z", to: "${y}-12-31T23:59:59Z") {
        totalCommitContributions
        restrictedContributionsCount
        contributionCalendar { totalContributions }
      }`
    )
    .join("\n");
  const per = (await gql(`{ user(login: "${LOGIN}") { ${parts} } }`)).user;

  let contributions = 0;
  let commits = 0;
  const perYear = [];
  for (const y of years) {
    const c = per[`y${y}`];
    contributions += c.contributionCalendar.totalContributions;
    commits += c.totalCommitContributions;
    perYear.push({ year: y, count: c.contributionCalendar.totalContributions });
  }
  perYear.sort((a, b) => a.year - b.year);
  return { createdAt: u.createdAt, contributions, commits, repos: u.repositories.totalCount, perYear };
}

function renderYears(perYear) {
  const W = 1000, H = 270;
  const font = "'Segoe UI',Ubuntu,'Helvetica Neue',Arial,sans-serif";
  const top = 78, bottom = 222; // bar area
  const max = Math.max(...perYear.map((p) => p.count), 1);
  const n = perYear.length;
  const slot = (W - 80) / n;
  const bw = Math.min(72, slot * 0.55);

  const bars = perYear
    .map((p, i) => {
      const cx = 40 + slot * i + slot / 2;
      const h = Math.max(3, ((bottom - top) * p.count) / max);
      const y = bottom - h;
      return `
  <rect x="${(cx - bw / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="6" fill="url(#bar)"/>
  <text x="${cx.toFixed(1)}" y="${(y - 8).toFixed(1)}" text-anchor="middle" font-size="14" font-weight="700" fill="#FFFFFF">${fmt(p.count)}</text>
  <text x="${cx.toFixed(1)}" y="${bottom + 24}" text-anchor="middle" font-size="13" fill="#8B93C9">${p.year}</text>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${font}">
  <defs>
    <linearGradient id="ybg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0B1026"/>
      <stop offset="1" stop-color="#1B1145"/>
    </linearGradient>
    <linearGradient id="bar" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#00E5FF"/>
      <stop offset="1" stop-color="#7C4DFF"/>
    </linearGradient>
  </defs>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="16" fill="url(#ybg)" stroke="#2D2A6B"/>
  <text x="28" y="40" font-size="18" font-weight="700" fill="#00E5FF">Contributions by Year</text>
  <text x="${W - 28}" y="40" text-anchor="end" font-size="12" fill="#8B93C9">public + private</text>
  <line x1="40" y1="${bottom}" x2="${W - 40}" y2="${bottom}" stroke="#2D2A6B"/>${bars}
</svg>
`;
}

async function fetchLanguages() {
  const totals = new Map(); // name -> { size, color }
  let after = null;
  do {
    const data = await gql(`{
      user(login: "${LOGIN}") {
        repositories(first: 100, ownerAffiliations: OWNER, isFork: false${after ? `, after: "${after}"` : ""}) {
          pageInfo { hasNextPage endCursor }
          nodes {
            languages(first: 20, orderBy: { field: SIZE, direction: DESC }) {
              edges { size node { name color } }
            }
          }
        }
      }
    }`);
    const repos = data.user.repositories;
    for (const repo of repos.nodes) {
      for (const { size, node } of repo.languages.edges) {
        if (LANG_IGNORE.has(node.name)) continue;
        const cur = totals.get(node.name) || { size: 0, color: node.color || "#8B93C9" };
        cur.size += size;
        totals.set(node.name, cur);
      }
    }
    after = repos.pageInfo.hasNextPage ? repos.pageInfo.endCursor : null;
  } while (after);

  const sorted = [...totals.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, LANG_LIMIT);
  const sum = sorted.reduce((s, [, v]) => s + v.size, 0) || 1;
  return sorted.map(([name, v]) => ({ name, color: v.color, pct: (v.size / sum) * 100 }));
}

function renderLanguages(langs) {
  const W = 350, H = 200;
  const font = "'Segoe UI',Ubuntu,'Helvetica Neue',Arial,sans-serif";
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

  // Donut: one circle per language, offset along the ring with stroke-dasharray
  const r = 46, cx = 272, cy = 112, C = 2 * Math.PI * r;
  let offset = 0;
  const arcs = langs
    .map((l) => {
      const len = (l.pct / 100) * C;
      const arc = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${l.color}" stroke-width="14"
        stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}"
        transform="rotate(-90 ${cx} ${cy})"/>`;
      offset += len;
      return arc;
    })
    .join("");

  const legend = langs
    .map((l, i) => {
      const y = 58 + i * 17;
      return `<circle cx="28" cy="${y - 4}" r="4.5" fill="${l.color}"/>
    <text x="40" y="${y}" font-size="12" fill="#C9D1FF">${esc(l.name)} <tspan fill="#8B93C9">${l.pct.toFixed(2)}%</tspan></text>`;
    })
    .join("\n    ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${font}">
  <defs>
    <linearGradient id="lbg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0B1026"/>
      <stop offset="1" stop-color="#1B1145"/>
    </linearGradient>
  </defs>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="16" fill="url(#lbg)" stroke="#2D2A6B"/>
  <text x="22" y="32" font-size="16" font-weight="700" fill="#00E5FF">Most Used Languages</text>
  <text x="${W - 22}" y="32" text-anchor="end" font-size="11" fill="#8B93C9">public + private</text>
  ${legend}
  ${arcs}
</svg>
`;
}

const fmt = (n) => n.toLocaleString("en-US");

function render({ createdAt, contributions, commits, repos }) {
  const joined = new Date(createdAt);
  const yearsOn = Math.floor((Date.now() - joined) / (365.25 * 24 * 3600 * 1000));
  const since = joined.toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

  const tiles = [
    { value: `${yearsOn}+ yrs`, label: "on GitHub", sub: `since ${since}` },
    { value: fmt(contributions), label: "contributions", sub: "all years" },
    { value: fmt(commits), label: "commits", sub: "public + private" },
    { value: fmt(repos), label: "repositories", sub: "public + private" },
    { value: APP_DOWNLOADS, label: "app downloads", sub: "on Google Play" },
  ];

  // Dark theme matching the profile's GitHub Stats cards
  const W = 1000, H = 130, gap = 12, pad = 0.5;
  const tw = (W - pad * 2 - gap * (tiles.length - 1)) / tiles.length;
  const font = "'Segoe UI',Ubuntu,'Helvetica Neue',Arial,sans-serif";

  const cells = tiles
    .map((t, i) => {
      const x = pad + i * (tw + gap);
      const cx = x + tw / 2;
      return `
  <g>
    <rect x="${x}" y="0.5" width="${tw}" height="${H - 1}" rx="16" fill="url(#bg)" stroke="#2D2A6B"/>
    <text x="${cx}" y="60" text-anchor="middle" font-size="32" font-weight="700" fill="#00E5FF">${t.value}</text>
    <text x="${cx}" y="88" text-anchor="middle" font-size="14" font-weight="600" fill="#FFFFFF">${t.label}</text>
    <text x="${cx}" y="110" text-anchor="middle" font-size="12" fill="#8B93C9">${t.sub}</text>
  </g>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${font}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0B1026"/>
      <stop offset="1" stop-color="#1B1145"/>
    </linearGradient>
  </defs>${cells}
</svg>
`;
}

const MOCK_LANGS = [
  ["TypeScript", "#3178c6", 45.95], ["Java", "#b07219", 26.32], ["Kotlin", "#A97BFF", 17.9],
  ["JavaScript", "#f1e05a", 8.85], ["Python", "#3572A5", 0.31], ["C++", "#f34b7d", 0.29],
  ["PLpgSQL", "#336790", 0.2], ["Dart", "#00B4AB", 0.18],
].map(([name, color, pct]) => ({ name, color, pct }));

const MOCK_YEARS = [[2020, 1], [2021, 113], [2022, 28], [2023, 240], [2024, 51], [2025, 34], [2026, 625]]
  .map(([year, count]) => ({ year, count }));

const data = process.env.MOCK
  ? { createdAt: "2020-11-10T10:00:00Z", contributions: 1092, commits: 1003, repos: 82, perYear: MOCK_YEARS }
  : await fetchStats();
const langs = process.env.MOCK ? MOCK_LANGS : await fetchLanguages();

for (const f of [OUT, LANG_OUT, YEARS_OUT]) mkdirSync(f.split("/").slice(0, -1).join("/") || ".", { recursive: true });
writeFileSync(OUT, render(data));
writeFileSync(LANG_OUT, renderLanguages(langs));
writeFileSync(YEARS_OUT, renderYears(data.perYear));
console.log("Wrote", OUT, data);
console.log("Wrote", YEARS_OUT, data.perYear.map((p) => `${p.year}: ${p.count}`).join(", "));
console.log("Wrote", LANG_OUT, langs.map((l) => `${l.name} ${l.pct.toFixed(2)}%`).join(", "));
