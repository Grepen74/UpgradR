#!/usr/bin/env node
/**
 * Wipes and re-seeds the demo/showcase account with a rich, fully fictional
 * job-search "journey" -- every status in the taxonomy represented, tasks,
 * notes, companies, contacts, a candidate profile and search preferences.
 * Repeatable on demand: every run starts from a completely clean slate.
 *
 * Design (see scripts/lib/demo-account.mjs for the full rationale):
 *   - Reset = delete + recreate the one dedicated demo auth.users row.
 *     Every owner-scoped table cascades from it, so this wipes everything
 *     belonging to the demo account in one step, safely isolated from any
 *     real account by the same RLS that isolates two real users.
 *   - Applications, status transitions, tasks and notes are created through
 *     real MCP tool calls (the same ones a connected agent would use) --
 *     not raw SQL -- so this doubles as a live check that the deployed MCP
 *     server still works end to end.
 *   - Candidate profile, preferences, companies, contacts and labels are
 *     created via direct, RLS-scoped table writes, because none of those
 *     are MCP-writable by design (see docs/mcp-tools.md) -- this mirrors
 *     exactly what the web app's own profile/company editors do.
 *
 * Usage:
 *   npm run demo:reset
 *   npm run demo:reset -- --yes                 (skip the confirmation prompt)
 *   npm run demo:reset -- --email demo@upgradr.app
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY exported in this terminal. Never reads
 * it from a file, never logs it.
 */
import { createInterface } from "node:readline/promises";

import { createMcpClient } from "./lib/mcp-agent-auth.mjs";
import {
  createAnonClient,
  createServiceClient,
  DEFAULT_DEMO_EMAIL,
  deleteExistingDemoUser,
  mintDemoMcpToken,
  mintDemoSession,
  PROD_APP_ORIGIN,
  PROD_MCP_URL,
  PROD_SUPABASE_ANON_KEY,
  PROD_SUPABASE_URL,
  requireServiceRoleKey,
} from "./lib/demo-account.mjs";

function parseArgs(argv) {
  const args = { email: DEFAULT_DEMO_EMAIL, yes: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--email") args.email = argv[++i];
    else if (arg === "--yes" || arg === "-y") args.yes = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
  }
  return args;
}

function daysFromNow(offset) {
  return new Date(Date.now() + offset * 24 * 60 * 60 * 1000).toISOString();
}

// -- The fictional dataset -----------------------------------------------
// Every URL/domain uses *.example.com, reserved by RFC 2606 for exactly this
// purpose: guaranteed fake, never resolves to a real site, unmistakably not
// real personal data. `path` is the sequence of move_application_status
// calls after creation (which always starts a proposal at "proposed"); the
// last entry is the item's final, screenshot-ready status.
const APPLICATIONS = [
  {
    key: "nimbus",
    title: "Staff Frontend Engineer",
    companyName: "Nimbus Cloud",
    location: "Remote (EU)",
    sourceUrl: "https://boards.example.com/nimbus-cloud/staff-frontend-engineer",
    sourceProvider: "linkedin",
    compensationMin: 95000,
    compensationMax: 120000,
    compensationPeriod: "year",
    compensationCurrency: "EUR",
    matchScore: 88,
    matchRationale: "Strong overlap with React/TypeScript depth and a remote-first culture.",
    strengths: ["8 years of React experience", "Led a design-system migration"],
    gaps: ["No prior fintech domain experience"],
    confidence: 0.86,
    path: [],
  },
  {
    key: "fintrack",
    title: "Senior Product Engineer",
    companyName: "Fintrack Labs",
    location: "Remote",
    sourceUrl: "https://boards.example.com/fintrack-labs/senior-product-engineer",
    sourceProvider: "greenhouse",
    compensationMin: 6800,
    compensationMax: 8200,
    compensationPeriod: "month",
    compensationCurrency: "EUR",
    matchScore: 79,
    matchRationale: "Good product-sense fit; less certain on the GraphQL federation experience they want.",
    strengths: ["Owns features end-to-end", "Comfortable working directly with design"],
    gaps: ["Limited GraphQL federation experience"],
    confidence: 0.75,
    path: [{ status: "shortlisted", note: "Reviewed and shortlisted -- worth prioritizing." }],
  },
  {
    key: "solstice",
    title: "Frontend Engineer II",
    companyName: "Solstice Analytics",
    location: "Berlin, Germany",
    sourceUrl: "https://boards.example.com/solstice-analytics/frontend-engineer-ii",
    sourceProvider: "company-site",
    matchScore: 70,
    matchRationale: "Solid role, but slightly more junior in scope than target level.",
    strengths: ["Strong TypeScript fundamentals"],
    gaps: ["Role is scoped below target seniority"],
    confidence: 0.8,
    path: [{ status: "saved", note: "Saving for later; scope is a bit junior for now." }],
  },
  {
    key: "brightpath",
    title: "Software Engineer, Web",
    companyName: "Brightpath Robotics",
    location: "Amsterdam, Netherlands",
    sourceUrl: "https://boards.example.com/brightpath-robotics/software-engineer-web",
    sourceProvider: "lever",
    matchScore: 74,
    matchRationale: "Interesting hardware-adjacent product; web stack matches well.",
    strengths: ["React + real-time dashboards experience"],
    gaps: ["No robotics/hardware domain background"],
    confidence: 0.7,
    path: [
      { status: "shortlisted" },
      { status: "preparing", note: "Started drafting a tailored cover letter." },
    ],
  },
  {
    key: "vertex",
    title: "Senior Frontend Engineer",
    companyName: "Vertex Dynamics",
    location: "Remote",
    sourceUrl: "https://boards.example.com/vertex-dynamics/senior-frontend-engineer",
    sourceProvider: "company-site",
    compensationMin: 100000,
    compensationMax: 125000,
    compensationPeriod: "year",
    compensationCurrency: "EUR",
    matchScore: 91,
    matchRationale: "Excellent match: developer-tools domain, small team, remote-first.",
    strengths: ["Built a component library used company-wide", "Strong systems-design communication"],
    gaps: [],
    confidence: 0.9,
    path: [
      { status: "shortlisted" },
      { status: "preparing" },
      { status: "applied", note: "Submitted application through the company site." },
    ],
  },
  {
    key: "cloudforge",
    title: "Product Engineer",
    companyName: "CloudForge",
    location: "Remote (EU)",
    sourceUrl: "https://boards.example.com/cloudforge/product-engineer",
    sourceProvider: "linkedin",
    matchScore: 77,
    matchRationale: "Good generalist fit; team is still defining the frontend architecture.",
    strengths: ["Comfortable owning ambiguous problems"],
    gaps: ["Less backend exposure than the JD suggests they'd like"],
    confidence: 0.72,
    path: [
      { status: "shortlisted" },
      { status: "preparing" },
      { status: "applied" },
      { status: "screening", note: "Recruiter moved this to a screening call." },
    ],
  },
  {
    key: "eighthwall",
    title: "Frontend Architect",
    companyName: "8th Wall Systems",
    location: "Remote",
    sourceUrl: "https://boards.example.com/8th-wall-systems/frontend-architect",
    sourceProvider: "referral",
    compensationMin: 110000,
    compensationMax: 135000,
    compensationPeriod: "year",
    compensationCurrency: "EUR",
    matchScore: 93,
    matchRationale: "Referral from a former colleague; architecture scope closely matches recent design-system work.",
    strengths: ["Led architecture decisions for a 12-engineer team", "Deep performance-optimization experience"],
    gaps: [],
    confidence: 0.92,
    path: [
      { status: "shortlisted" },
      { status: "preparing" },
      { status: "applied" },
      { status: "screening" },
      { status: "interviewing", note: "Technical interview scheduled." },
    ],
  },
  {
    key: "lighthouse",
    title: "Staff Engineer",
    companyName: "Lighthouse Fintech",
    location: "Remote (EU)",
    sourceUrl: "https://boards.example.com/lighthouse-fintech/staff-engineer",
    sourceProvider: "greenhouse",
    compensationMin: 9000,
    compensationMax: 10500,
    compensationPeriod: "month",
    compensationCurrency: "EUR",
    matchScore: 85,
    matchRationale: "Strong technical match; fintech domain is new but the team seems supportive of ramp-up.",
    strengths: ["Track record mentoring engineers", "Strong TypeScript/testing discipline"],
    gaps: ["No prior fintech/compliance-heavy environment experience"],
    confidence: 0.8,
    path: [
      { status: "shortlisted" },
      { status: "preparing" },
      { status: "applied" },
      { status: "screening" },
      { status: "interviewing", note: "Onsite interview loop scheduled." },
    ],
  },
  {
    key: "meridian",
    title: "Senior Frontend Engineer",
    companyName: "Meridian Health Tech",
    location: "Remote",
    sourceUrl: "https://boards.example.com/meridian-health-tech/senior-frontend-engineer",
    sourceProvider: "company-site",
    compensationMin: 98000,
    compensationMax: 118000,
    compensationPeriod: "year",
    compensationCurrency: "EUR",
    matchScore: 89,
    matchRationale: "Mission-driven product with a healthy, well-scoped frontend role.",
    strengths: ["Accessibility-focused development background", "Comfortable in regulated environments"],
    gaps: [],
    confidence: 0.87,
    path: [
      { status: "shortlisted" },
      { status: "preparing" },
      { status: "applied" },
      { status: "screening" },
      { status: "interviewing" },
      { status: "offer", note: "Received a verbal offer; written offer pending." },
    ],
  },
  {
    key: "northwind",
    title: "Frontend Engineer",
    companyName: "Northwind Analytics",
    location: "Remote (EU)",
    sourceUrl: "https://boards.example.com/northwind-analytics/frontend-engineer",
    sourceProvider: "referral",
    compensationMin: 92000,
    compensationMax: 108000,
    compensationPeriod: "year",
    compensationCurrency: "EUR",
    matchScore: 90,
    matchRationale: "Referred in directly by a friend on the team; strong culture and role fit.",
    strengths: ["Existing relationship with the team", "Directly relevant recent project experience"],
    gaps: [],
    confidence: 0.9,
    path: [
      { status: "shortlisted" },
      { status: "preparing" },
      { status: "applied" },
      { status: "screening" },
      { status: "interviewing" },
      { status: "offer" },
      { status: "accepted", note: "Accepted! Start date set for November 3rd." },
    ],
  },
  {
    key: "globex",
    title: "Frontend Engineer",
    companyName: "Globex Corp",
    location: "Remote",
    sourceUrl: "https://boards.example.com/globex-corp/frontend-engineer",
    sourceProvider: "linkedin",
    matchScore: 68,
    matchRationale: "Decent stack match, but this company is now on the excluded list after learning more about the team.",
    strengths: ["Relevant stack experience"],
    gaps: ["Team went with an internal candidate"],
    confidence: 0.65,
    path: [
      { status: "shortlisted" },
      { status: "applied" },
      { status: "screening" },
      { status: "rejected", note: "Recruiter confirmed they moved forward with an internal candidate." },
    ],
  },
  {
    key: "acme",
    title: "Product Engineer",
    companyName: "Acme Cloud",
    location: "Amsterdam, Netherlands (on-site)",
    sourceUrl: "https://boards.example.com/acme-cloud/product-engineer",
    sourceProvider: "lever",
    matchScore: 72,
    matchRationale: "Good technical fit, but the on-site requirement doesn't match the target remote policy.",
    strengths: ["Strong product-engineering background"],
    gaps: ["Requires full-time on-site presence"],
    confidence: 0.7,
    path: [
      { status: "shortlisted" },
      { status: "preparing" },
      { status: "withdrawn", note: "Decided the on-site requirement doesn't fit right now." },
    ],
  },
  {
    key: "ferrous",
    title: "Frontend Engineer",
    companyName: "Ferrous Metals Software",
    location: "Remote",
    sourceUrl: "https://boards.example.com/ferrous-metals-software/frontend-engineer",
    sourceProvider: "company-site",
    matchScore: 55,
    matchRationale: "Stack overlaps, but the day-to-day scope is narrower than target roles.",
    strengths: ["Some relevant stack overlap"],
    gaps: ["Scope is narrower than target roles", "Lower-preference industry"],
    confidence: 0.6,
    path: [{ status: "dismissed", note: "Not a fit after reading the JD more closely." }],
  },
  {
    key: "oldco",
    title: "Frontend Developer",
    companyName: "OldCo Legacy Systems",
    location: "Remote",
    sourceUrl: "https://boards.example.com/oldco-legacy-systems/frontend-developer",
    sourceProvider: "linkedin",
    matchScore: 60,
    matchRationale: "An earlier lead that never went anywhere; kept for board history.",
    strengths: ["Relevant early-career stack"],
    gaps: ["Role level below target"],
    confidence: 0.6,
    path: [{ status: "rejected" }, { status: "archived", note: "Tidying up the board -- this one never went anywhere." }],
  },
];

const NOTES = {
  nimbus: "Found via LinkedIn Easy Apply. Stack matches closely -- worth prioritizing next review.",
  eighthwall:
    "Recruiter screen went great. Technical interview scheduled for next week; brush up on system-design talking points.",
  northwind: "Team feels like a strong culture fit. Genuinely excited about this one.",
  globex: "Screening call felt rushed and expectations on scope were unclear.",
};

const FOLLOW_UPS = [
  { key: "fintrack", title: "Research the team before applying", dueOffsetDays: 5 },
  { key: "vertex", title: "Tailor resume bullet points to the JD", dueOffsetDays: -3, completeImmediately: true },
  { key: "eighthwall", title: "Prepare system-design talking points", dueOffsetDays: 2 },
  { key: "lighthouse", title: "Send a thank-you note after the interview", dueOffsetDays: -1 },
  { key: "meridian", title: "Decide on the offer by Friday", dueOffsetDays: 4 },
];

const LABELS = [
  { name: "High Priority", color: "#7c3aed", applyTo: ["eighthwall", "lighthouse", "meridian"] },
  { name: "Referral", color: "#16a34a", applyTo: ["northwind", "eighthwall"] },
];

const COMPANIES = [
  {
    key: "nimbus",
    name: "Nimbus Cloud",
    websiteUrl: "https://www.nimbuscloud.example.com",
    industry: "Cloud Infrastructure",
    sizeRange: "201-500",
    notes: "Series C cloud infrastructure platform. Remote-first, ~400 employees.",
    contact: {
      fullName: "Priya Nandakumar",
      roleTitle: "Technical Recruiter",
      email: "priya.nandakumar@nimbuscloud.example.com",
    },
  },
  {
    key: "fintrack",
    name: "Fintrack Labs",
    websiteUrl: "https://www.fintracklabs.example.com",
    industry: "Fintech",
    sizeRange: "51-200",
    notes: "Personal finance SaaS, remote-first, ~120 employees.",
    contact: { fullName: "Marcus Webb", roleTitle: "Talent Partner", email: "marcus.webb@fintracklabs.example.com" },
  },
  {
    key: "vertex",
    name: "Vertex Dynamics",
    websiteUrl: "https://www.vertexdynamics.example.com",
    industry: "Developer Tools",
    sizeRange: "11-50",
    notes: "Profitable developer-tools company, small tight-knit team.",
    contact: { fullName: "Sara Kim", roleTitle: "Engineering Manager", email: "sara.kim@vertexdynamics.example.com" },
  },
  {
    key: "eighthwall",
    name: "8th Wall Systems",
    websiteUrl: "https://www.8thwallsystems.example.com",
    industry: "AR / Analytics",
    sizeRange: "51-200",
    notes: "AR analytics platform, Series B, referral connection on the team.",
    contact: { fullName: "Jordan Ellis", roleTitle: "Senior Recruiter", email: "jordan.ellis@8thwallsystems.example.com" },
  },
  {
    key: "northwind",
    name: "Northwind Analytics",
    websiteUrl: "https://www.northwindanalytics.example.com",
    industry: "B2B Analytics",
    sizeRange: "500+",
    notes: "Recently IPO'd B2B analytics company.",
    contact: {
      fullName: "Taylor Brooks",
      roleTitle: "People Ops Lead",
      email: "taylor.brooks@northwindanalytics.example.com",
    },
  },
];

const CANDIDATE_PROFILE = {
  headline: "Senior Frontend Engineer | React & TypeScript | Remote-first",
  summary:
    "Frontend engineer with 8+ years building and scaling web applications, most recently leading a design-system " +
    "migration for a 40-person product org. Comfortable owning features end-to-end, from architecture through " +
    "accessibility and performance. Looking for remote-first teams solving real operational problems.",
};

const EXPERIENCES = [
  {
    company: "TechNova Inc.",
    title: "Senior Frontend Engineer",
    description:
      "Led the migration to a shared design system across 6 product teams; mentored 3 mid-level engineers; " +
      "drove adoption of automated accessibility testing.",
    start_date: "2022-03-01",
    end_date: null,
    is_current: true,
    sort_order: 0,
  },
  {
    company: "Bluebird Software",
    title: "Frontend Engineer",
    description:
      "Built and maintained the core customer dashboard; introduced TypeScript incrementally across a large " +
      "legacy JavaScript codebase.",
    start_date: "2019-06-01",
    end_date: "2022-02-01",
    is_current: false,
    sort_order: 1,
  },
];

const EDUCATION = [{ institution: "State University", degree: "B.Sc.", field_of_study: "Computer Science", sort_order: 0 }];

const SKILLS = ["TypeScript", "React", "Node.js", "GraphQL", "Web Accessibility", "System Design", "Performance Optimization"];

const PREFERENCES = {
  target_roles: ["Senior Frontend Engineer", "Staff Engineer", "Product Engineer"],
  locations: ["Remote", "Berlin, Germany", "Amsterdam, Netherlands"],
  remote_policy: "remote",
  minimum_compensation: 90000,
  compensation_currency: "EUR",
  industries: ["SaaS", "Fintech", "Developer Tools"],
  excluded_companies: ["Globex Corp"],
  notes:
    "Prioritizing remote-first teams with a strong engineering culture. Open to hybrid for an exceptional role, " +
    "not open to full-time on-site.",
};

// -- Orchestration ----------------------------------------------------------

async function confirm(email) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    `\nThis will PERMANENTLY DELETE any existing account and data for ${email} on the ` +
      `production project, then recreate it with fresh demo data.\n` +
      `Type "yes" to continue: `,
  );
  rl.close();
  return answer.trim().toLowerCase() === "yes";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`
Wipe and re-seed the demo/showcase account.

  --email <address>   Demo account to (re)create. Default: ${DEFAULT_DEMO_EMAIL}
  --yes, -y            Skip the confirmation prompt.

Requires SUPABASE_SERVICE_ROLE_KEY in this terminal.
`);
    return;
  }

  const serviceRoleKey = requireServiceRoleKey();
  if (!args.yes && !(await confirm(args.email))) {
    console.log("Aborted.");
    return;
  }

  const serviceClient = createServiceClient({ supabaseUrl: PROD_SUPABASE_URL, serviceRoleKey });
  const anonClient = createAnonClient({ supabaseUrl: PROD_SUPABASE_URL, anonKey: PROD_SUPABASE_ANON_KEY });

  console.log(`\nResetting ${args.email}...`);
  const deleted = await deleteExistingDemoUser(serviceClient, args.email);
  console.log(deleted ? "Deleted the existing demo account." : "No existing demo account found -- creating fresh.");
  // A short settle delay after a fresh delete: generateLink() immediately
  // afterward has intermittently landed on a not-yet-fully-committed row,
  // surfacing as "Email link is invalid or has expired" from verifyOtp()
  // even though mintDemoSession() itself already retries that step.
  if (deleted) await new Promise((resolve) => setTimeout(resolve, 1000));

  const { session, userId } = await mintDemoSession({
    serviceClient,
    anonClient,
    email: args.email,
    redirectTo: `${PROD_APP_ORIGIN}/api/auth/callback`,
  });
  console.log(`Created demo account ${args.email} (${userId}).`);

  // --- Candidate profile, education, skills, preferences (direct writes:
  // none of this is MCP-writable by design) ---------------------------------
  // Note: app.handle_new_user() (a trigger on auth.users insert) already
  // auto-created empty candidate_profiles/job_search_preferences stub rows
  // for this owner_id the moment the account was created above -- so these
  // are updates against that existing row, not inserts.
  console.log("Seeding candidate profile and preferences...");
  const { data: profileRow, error: profileError } = await anonClient
    .from("candidate_profiles")
    .update({ ...CANDIDATE_PROFILE })
    .eq("owner_id", userId)
    .select("id")
    .single();
  if (profileError) throw new Error(`candidate_profiles update failed: ${profileError.message}`);

  const { error: experiencesError } = await anonClient.from("profile_experiences").insert(
    EXPERIENCES.map((experience) => ({ owner_id: userId, candidate_profile_id: profileRow.id, ...experience })),
  );
  if (experiencesError) throw new Error(`profile_experiences insert failed: ${experiencesError.message}`);

  const { error: educationError } = await anonClient.from("profile_education").insert(
    EDUCATION.map((entry) => ({ owner_id: userId, candidate_profile_id: profileRow.id, ...entry })),
  );
  if (educationError) throw new Error(`profile_education insert failed: ${educationError.message}`);

  const { error: skillsError } = await anonClient.from("profile_skills").insert(
    SKILLS.map((name) => ({ owner_id: userId, candidate_profile_id: profileRow.id, name })),
  );
  if (skillsError) throw new Error(`profile_skills insert failed: ${skillsError.message}`);

  const { error: preferencesError } = await anonClient
    .from("job_search_preferences")
    .update({ ...PREFERENCES })
    .eq("owner_id", userId);
  if (preferencesError) throw new Error(`job_search_preferences update failed: ${preferencesError.message}`);

  // --- Companies and contacts (direct writes: no MCP tool for either) ------
  console.log("Seeding companies and contacts...");
  const companyIdsByKey = {};
  const contactIdsByKey = {};
  for (const company of COMPANIES) {
    const { data: companyRow, error: companyError } = await anonClient
      .from("companies")
      .insert({
        owner_id: userId,
        name: company.name,
        website_url: company.websiteUrl,
        industry: company.industry,
        size_range: company.sizeRange,
        notes: company.notes,
      })
      .select("id")
      .single();
    if (companyError) throw new Error(`companies insert failed for ${company.name}: ${companyError.message}`);
    companyIdsByKey[company.key] = companyRow.id;

    const { data: contactRow, error: contactError } = await anonClient
      .from("contacts")
      .insert({
        owner_id: userId,
        company_id: companyRow.id,
        full_name: company.contact.fullName,
        role_title: company.contact.roleTitle,
        email: company.contact.email,
      })
      .select("id")
      .single();
    if (contactError) throw new Error(`contacts insert failed for ${company.name}: ${contactError.message}`);
    contactIdsByKey[company.key] = contactRow.id;
  }

  // --- MCP: applications, status journeys, tasks, notes --------------------
  console.log("Signing in to the MCP server...");
  const { accessToken } = await mintDemoMcpToken({
    anonClient,
    session,
    supabaseUrl: PROD_SUPABASE_URL,
    anonKey: PROD_SUPABASE_ANON_KEY,
    mcpUrl: PROD_MCP_URL,
    scopes: ["mcp", "profile:read", "opportunities:read", "applications:read", "applications:write"],
  });
  const call = createMcpClient({ mcpUrl: PROD_MCP_URL, accessToken });
  await call("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "upgradr-demo-seed", version: "0.1.0" },
  });

  console.log(`Creating ${APPLICATIONS.length} job proposals...`);
  const proposalsResponse = await call("tools/call", {
    name: "create_job_proposals",
    arguments: {
      proposals: APPLICATIONS.map((app) => ({
        title: app.title,
        companyName: app.companyName,
        location: app.location,
        sourceUrl: app.sourceUrl,
        sourceProvider: app.sourceProvider,
        compensationMin: app.compensationMin,
        compensationMax: app.compensationMax,
        compensationPeriod: app.compensationPeriod,
        compensationCurrency: app.compensationCurrency,
        matchScore: app.matchScore,
        matchRationale: app.matchRationale,
        strengths: app.strengths,
        gaps: app.gaps,
        confidence: app.confidence,
      })),
    },
  });
  // Only the two profile tools declare an outputSchema (see the matching
  // Traps entry in plan.md), so structuredContent is not a reliable channel
  // for any other tool -- parse the same content[0].text JSON every other
  // script and the e2e harness already rely on.
  const proposalsOutcome = JSON.parse(proposalsResponse.result?.content?.[0]?.text ?? "{}");
  const results = proposalsOutcome.results ?? [];

  const applicationIdsByKey = {};
  results.forEach((result, index) => {
    const app = APPLICATIONS[index];
    if (result.outcome === "created") {
      applicationIdsByKey[app.key] = result.application.id;
    } else {
      console.warn(`Unexpected outcome for "${app.title}": ${result.outcome} (expected "created" on a fresh account)`);
    }
  });

  console.log("Walking each application through its status history...");
  await Promise.all(
    APPLICATIONS.map(async (app) => {
      const applicationId = applicationIdsByKey[app.key];
      if (!applicationId) return;
      for (const step of app.path) {
        const response = await call("tools/call", {
          name: "move_application_status",
          arguments: { applicationId, newStatus: step.status, ...(step.note ? { note: step.note } : {}) },
        });
        if (response.error || response.result?.isError) {
          console.warn(`Status transition failed for ${app.companyName} -> ${step.status}: ${JSON.stringify(response.error ?? response.result)}`);
          break;
        }
      }
    }),
  );

  console.log("Linking companies and contacts to their applications...");
  for (const company of COMPANIES) {
    const applicationId = applicationIdsByKey[company.key];
    if (!applicationId) continue;
    const { error } = await anonClient
      .from("applications")
      .update({ company_id: companyIdsByKey[company.key], primary_contact_id: contactIdsByKey[company.key] })
      .eq("id", applicationId);
    if (error) console.warn(`Could not link company for ${company.name}: ${error.message}`);
  }

  console.log("Adding notes...");
  for (const [key, body] of Object.entries(NOTES)) {
    const applicationId = applicationIdsByKey[key];
    if (!applicationId) continue;
    const response = await call("tools/call", { name: "add_note", arguments: { applicationId, body } });
    if (response.error) console.warn(`add_note failed for ${key}: ${JSON.stringify(response.error)}`);
  }

  console.log("Creating follow-up tasks...");
  for (const followUp of FOLLOW_UPS) {
    const applicationId = applicationIdsByKey[followUp.key];
    if (!applicationId) continue;
    const response = await call("tools/call", {
      name: "create_follow_up",
      arguments: { applicationId, title: followUp.title, dueAt: daysFromNow(followUp.dueOffsetDays) },
    });
    const followUpRow = JSON.parse(response.result?.content?.[0]?.text ?? "{}");
    const followUpId = followUpRow.id;
    if (followUp.completeImmediately && followUpId) {
      await call("tools/call", { name: "complete_follow_up", arguments: { followUpId } });
    }
  }

  // --- Labels (direct writes: browser-only feature, no MCP scope for it) --
  console.log("Creating labels...");
  for (const label of LABELS) {
    const { data: labelRow, error: labelError } = await anonClient
      .from("labels")
      .insert({ owner_id: userId, name: label.name, color: label.color })
      .select("id")
      .single();
    if (labelError) {
      console.warn(`labels insert failed for ${label.name}: ${labelError.message}`);
      continue;
    }
    for (const key of label.applyTo) {
      const applicationId = applicationIdsByKey[key];
      if (!applicationId) continue;
      const { error } = await anonClient
        .from("application_labels")
        .insert({ application_id: applicationId, label_id: labelRow.id, owner_id: userId });
      if (error) console.warn(`Could not attach label "${label.name}" to ${key}: ${error.message}`);
    }
  }

  const createdCount = Object.keys(applicationIdsByKey).length;
  console.log(
    `\nDone. Seeded ${createdCount}/${APPLICATIONS.length} applications, ${COMPANIES.length} companies, ` +
      `${Object.keys(NOTES).length} notes, ${FOLLOW_UPS.length} follow-ups, ${LABELS.length} labels.\n\n` +
      `Sign in and take a look:\n  npm run demo:login\n`,
  );
}

main().catch((error) => {
  console.error(`\n${error.message}\n`);
  process.exit(1);
});
