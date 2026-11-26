// Builds assets/stats.svg: account age, all-time contributions and commits
// (public + private), repository count, and app downloads.
// Runs in GitHub Actions with METRICS_TOKEN (classic PAT: repo + read:user).
// Set MOCK=1 to render with sample data and no network.
import { writeFileSync, mkdirSync } from "node:fs";

const LOGIN = "madhwendrashukla";
const APP_DOWNLOADS = "60K+"; // Play Store total, update by hand when it grows
const OUT = process.env.OUT || "assets/stats.svg";

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
  for (const y of years) {
    const c = per[`y${y}`];
    contributions += c.contributionCalendar.totalContributions;
    commits += c.totalCommitContributions;
  }
  return { createdAt: u.createdAt, contributions, commits, repos: u.repositories.totalCount };
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

const data = process.env.MOCK
  ? { createdAt: "2020-11-10T10:00:00Z", contributions: 1092, commits: 1003, repos: 82 }
  : await fetchStats();
mkdirSync(OUT.split("/").slice(0, -1).join("/") || ".", { recursive: true });
writeFileSync(OUT, render(data));
console.log("Wrote", OUT, data);
