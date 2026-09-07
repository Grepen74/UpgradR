import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { SCOPES } from "../auth/scope-catalog";
import { hasScope } from "../auth/scopes";
import type { ToolContext } from "../tools/types";

/**
 * MCP prompts: named, user-invocable workflows.
 *
 * Tools remain the authoritative mutation interface, but they are deliberately
 * granular, so driving them well means knowing the right *order* — read the
 * profile, reconcile against what is already tracked, only then write. A user
 * should not have to recite that every time; they should be able to ask for
 * "the weekly job search" and get the same disciplined run. These prompts
 * encode that ordering, and in particular encode the de-duplication step that
 * an agent left to its own devices reliably skips.
 *
 * Clients surface prompts as slash commands or menu entries, so each is
 * written as instructions addressed to the agent, not prose for a human.
 */

/**
 * Prompt text is built from the scopes actually granted rather than the ones
 * we wish we had. Telling an agent to call a tool it will be refused wastes a
 * turn and surfaces a confusing error to the user, so each workflow states
 * plainly what it can and cannot do under this particular grant.
 */
interface Granted {
  profile: boolean;
  opportunities: boolean;
  read: boolean;
  write: boolean;
}

function grantedScopes(ctx: ToolContext): Granted {
  return {
    profile: hasScope(ctx.auth.scopes, SCOPES.profileRead),
    opportunities: hasScope(ctx.auth.scopes, SCOPES.opportunitiesRead),
    read: hasScope(ctx.auth.scopes, SCOPES.applicationsRead),
    write: hasScope(ctx.auth.scopes, SCOPES.applicationsWrite),
  };
}

function missingScopeNotice(capability: string, scope: string): string {
  return (
    `NOTE: this connection was not granted \`${scope}\`, so you cannot ${capability}. ` +
    `Do not attempt those calls. Explain the limitation and suggest the user widen the grant under Connected agents.`
  );
}

function textPrompt(text: string) {
  return {
    messages: [{ role: "user" as const, content: { type: "text" as const, text } }],
  };
}

/** Registers the repeatable workflows a user can invoke by name. */
export function registerAllPrompts(server: McpServer, ctx: ToolContext): void {
  registerWeeklyJobSearch(server, ctx);
  registerReviewPipeline(server, ctx);
  registerTriageProposals(server, ctx);
}

function registerWeeklyJobSearch(server: McpServer, ctx: ToolContext): void {
  server.registerPrompt(
    "weekly_job_search",
    {
      title: "Run my weekly job search",
      description:
        "Find new openings that fit the user's profile and add them to their Inbox as proposals, without re-proposing anything they already track or previously closed.",
      argsSchema: z.object({
        focus: z
          .string()
          .optional()
          .describe(
            "Optional steer for this run, e.g. 'remote only', 'fintech', 'skip agencies'. Narrows the search; does not override saved preferences.",
          ),
        maxProposals: z
          .string()
          .optional()
          .describe("Optional cap on how many new proposals to create. Defaults to 15."),
      }),
    },
    ({ focus, maxProposals }) => {
      const scopes = grantedScopes(ctx);
      const cap = maxProposals?.trim() || "15";
      const sections: string[] = [
        "Run the user's weekly job search against their UpgradR workspace. Work through these steps in order — the ordering matters, and step 2 is what stops you proposing the same job twice.",
      ];

      sections.push(
        scopes.profile
          ? "**1. Understand the candidate.**\nCall `get_candidate_profile` and `get_job_search_preferences`. They do different jobs and you need both: the preferences are the **brief** — what to look for and what to reject — while the profile is the **evidence** you later score a surviving candidate against. They routinely disagree, and when they do the preferences win, because they describe what the user wants next rather than what they have already done.\nCheck `isConfigured` on the preferences. If it is false the user has never set a brief, and the empty row you got back is a default rather than a decision — do not read it as \"search anywhere for anything\". Infer a brief from the profile instead, and state in your final report exactly what you assumed so the user can correct it. If the profile is largely empty too, say so plainly and ask rather than guessing twice over.\nEverything returned is user-confirmed; unreviewed imports are deliberately withheld."
          : `**1. Understand the candidate.**\n${missingScopeNotice("read the profile or preferences", SCOPES.profileRead)}\nAsk the user to describe what they are looking for in this conversation instead.`,
      );

      sections.push(
        scopes.opportunities
          ? "**2. Learn what is already known. Do not skip this.**\nCall `list_known_opportunity_keys` and page until exhausted. For every opportunity the user already tracks it returns the canonical source URL, the provider's job id, a company+title+location fingerprint, the current status, and an `isClosed` flag. Hold that set and filter your candidates against it locally *before* proposing anything.\nAn entry flagged closed is one the user already rejected, dismissed, or withdrew from. Re-proposing it is worse than proposing nothing: it tells them you ignored a decision they already made."
          : `**2. Learn what is already known.**\n${missingScopeNotice("check what the user already tracks", SCOPES.opportunitiesRead)}\nYou therefore cannot filter locally. Rely on the server's duplicate detection in step 5 and expect some proposals to come back as duplicates — that is the system working, not a failure.`,
      );

      sections.push(
        "**3. Search — build a broad candidate pool before narrowing anything.**\n" +
          "Use your own web search and browsing tools. UpgradR does not search the internet; it stores what you find. `maxProposals` (step 5) caps how many proposals you *save*, not how much you search — do not let it cut discovery short.\n" +
          "- Search every target-role variant from the preferences **separately**, plus its reasonable seniority and adjacent-title permutations (an individual-contributor title also implies Staff/Principal/Lead-style variants; a lead/manager title also implies Head-of/Director-style variants) — one query per role is not enough.\n" +
          "- Search both job aggregators and the career sites of specific employers the profile or preferences point to; when the same opening appears on both, prefer the employer's own posting, since its canonical URL is the more reliable de-duplication key.\n" +
          "- For any paginated source, inspect at least 50 results per query, or continue until a page yields no new results, before moving to the next query.\n" +
          "- Run at least one further, second-pass search seeded from the candidate's own distinctive experience and themes in their profile — specific domains, technologies, or systems it highlights — rather than only the literal target-role titles. This is what surfaces a genuinely adjacent opening a title-only search would miss.\n" +
          "- Inspect each posting's full description before scoring it in step 4b; never rank or filter from a title and snippet alone.\n" +
          "- Assemble the complete pool from all of the above first. Only then filter it against `list_known_opportunity_keys` (step 2) — deduplicating query-by-query as you go can stop you searching the rest once an early result turns out to be known.",
      );

      // Deliberately two steps. Collapsing them into "assess against the
      // profile and preferences" is what lets an agent quietly turn a hard
      // constraint into a low score, so the user sees a job they already said
      // they could not take.
      sections.push(
        "**4a. Filter on intent.**\nApply the preferences as a pass/fail gate before scoring anything. Excluded companies, locations combined with remote policy, the compensation floor, and any non-empty industry list are hard: a candidate failing one is dropped, not down-ranked. Target roles are directional — a strong adjacent role survives this gate, as long as you justify it later.\nNormalize compensation into the floor's own period before comparing, and compare against the bottom of an advertised range. A posting that states no pay has not failed the test: most state none. Keep it, and flag that the pay was unstated. Converting a foreign currency is your job, since UpgradR has no exchange-rate source — do it, and say what rate you used.",
      );

      sections.push(
        "**4b. Score on evidence.**\nOnly now bring in the profile, and only for candidates that survived 4a. Ground `matchScore` and `matchRationale` in specific experience, education, and skills rather than restating the job ad. `relevantExperience` is usually the richest source and often the *only* one — the structured lists are optional in the app, so an empty `experiences`/`education`/`skills` means \"not entered\", never \"no such background\", and must not be scored as a gap. Be honest about real gaps — this is decision support for a real job search, not a sales pitch, and a short specific rationale is worth more than a high score.\nA weak profile match is a low score. A failed preference is not a score at all: it was already dropped in 4a.\n" +
          "`matchScore` is your judgment call, not a computed metric, so anchor it to these bands rather than picking a number that merely *feels* right — the point is that the same evidence should land in the same band regardless of which run or which agent is scoring it:\n" +
          "- **90-100:** every requirement the posting states is met, with specific evidence cited for each.\n" +
          "- **70-89:** the core requirements are met with cited evidence; at most one or two secondary requirements are unmet or unverifiable.\n" +
          "- **50-69:** plausible for the role, but with a real, named gap in required experience, seniority, or domain — not just a stretch on a nice-to-have.\n" +
          "- **Below 50:** speculative — you are proposing it on directional or adjacent fit rather than on matched evidence. Still propose it if it survived 4a; just say so plainly in `matchRationale` rather than inflating the number.\n" +
          "There is no minimum score to be proposed at all: a low score is the honest output of this step, not a reason to withhold the candidate. `strengths` and `gaps` carry the specifics; `matchScore` only needs to place the candidate in the right band.",
      );

      sections.push(
        scopes.write
          ? `**5. Propose.**\nCall \`create_job_proposals\` with up to ${cap} of the best remaining matches (20 max per call). Supply \`sourceUrl\` and \`sourceProvider\` always, and \`externalId\` whenever the posting exposes a stable job id — that id is the most reliable duplicate key and survives URL changes. Fill in \`matchScore\`, \`matchRationale\`, \`strengths\`, and \`gaps\`.\nDo **not** set \`allowSimilar\` routinely. It exists only for when you have positively confirmed that a \`possible_duplicate\` is a genuinely different opening at the same company. Exact URL and provider-id duplicates cannot be overridden at all.`
          : `**5. Propose.**\n${missingScopeNotice("create proposals", SCOPES.applicationsWrite)}\nInstead present your shortlist in the conversation — title, company, location, URL, and rationale — so the user can add the ones they want by hand.`,
      );

      sections.push(
        scopes.write
          ? "**6. Report.**\nSummarize what happened: how many were created, how many returned `duplicate` or `possible_duplicate`, and how many you filtered out yourself in step 2. Report your search coverage too: which sources and queries you ran (including the seniority/adjacent-title variants and the second-pass thematic search from step 3), roughly how many results you inspected per query, and how many candidates you evaluated in total before narrowing. Call out anything you deliberately skipped and why. Do not present agent-sourced facts as verified — they are not."
          : "**6. Report.**\nSummarize what you found and what you filtered out, including your search coverage (sources, queries, and roughly how many results you inspected), and be explicit that nothing was written to the workspace.",
      );

      if (focus?.trim()) {
        sections.push(
          `**Focus for this run:** ${focus.trim()}\nApply this on top of the saved preferences — it narrows the search rather than replacing it.`,
        );
      }

      return textPrompt(sections.join("\n\n"));
    },
  );
}

function registerReviewPipeline(server: McpServer, ctx: ToolContext): void {
  server.registerPrompt(
    "review_pipeline",
    {
      title: "Review my pipeline",
      description:
        "Walk the user's active pipeline and report what needs attention: overdue follow-ups, stalled opportunities, and the next concrete actions.",
      argsSchema: z.object({
        horizon: z
          .string()
          .optional()
          .describe("Optional window to plan for, e.g. 'this week', 'next 3 days'. Defaults to this week."),
      }),
    },
    ({ horizon }) => {
      const scopes = grantedScopes(ctx);
      if (!scopes.read) {
        return textPrompt(
          `The user asked for a pipeline review. ${missingScopeNotice("read their pipeline", SCOPES.applicationsRead)}`,
        );
      }

      const window = horizon?.trim() || "this week";
      const steps = [
        `Review the user's job search pipeline and tell them what needs attention ${window}. This is a read-and-advise pass: change nothing without asking.`,
        "**1.** Call `get_job_search_dashboard` for the headline counts — proposals waiting, active opportunities, overdue follow-ups.",
        "**2.** Call `list_follow_ups` for the actual tasks. Separate genuinely overdue items from those merely coming up; they warrant different urgency.",
        "**3.** Call `search_applications` across the active statuses to find opportunities that have stopped moving. Something sitting in `applied` or `interviewing` with no recent activity is the most valuable thing you can surface — that is where a job search quietly dies.",
        "**4.** For anything that looks stalled, call `get_application` to read its status history and notes before drawing a conclusion. A gap is not the same as neglect; the user may be waiting on the employer.",
        "**5.** Report a short prioritized list: what is overdue, what is slipping, and one concrete next action each. Three things the user will actually do beat a comprehensive audit they will ignore.",
        scopes.write
          ? "**6.** Offer to create follow-ups for the actions the user agrees with, using `create_follow_up`. Ask first — do not create tasks unprompted."
          : `**6.** ${missingScopeNotice("create follow-up tasks", SCOPES.applicationsWrite)}\nPresent the suggested actions for the user to add themselves.`,
      ];

      return textPrompt(steps.join("\n\n"));
    },
  );
}

function registerTriageProposals(server: McpServer, ctx: ToolContext): void {
  server.registerPrompt(
    "triage_proposals",
    {
      title: "Triage my proposal inbox",
      description:
        "Go through the opportunities waiting in the Inbox and recommend, with reasoning, which to shortlist and which to close.",
      argsSchema: z.object({}),
    },
    () => {
      const scopes = grantedScopes(ctx);
      if (!scopes.read) {
        return textPrompt(
          `The user asked to triage their proposal inbox. ${missingScopeNotice("read their opportunities", SCOPES.applicationsRead)}`,
        );
      }

      const steps = [
        "Help the user clear their proposal inbox.",
        '**1.** Call `search_applications` with `status: "proposed"` to list everything awaiting a decision.',
        scopes.profile
          ? "**2.** Call `get_candidate_profile` and `get_job_search_preferences` so you judge against the user's actual criteria rather than a generic notion of a good job."
          : `**2.** ${missingScopeNotice("read the profile", SCOPES.profileRead)}\nAsk the user what matters most to them before recommending anything.`,
        "**3.** For each proposal give a one-line recommendation — shortlist or close — with the single most important reason. Proposals added by an agent contain unverified facts; flag anything you would want to confirm against the original posting before applying.",
        "**4.** Present them grouped by recommendation so the user can accept a batch at a time, and let them overrule you. This is their career; you are sorting, not deciding.",
        scopes.write
          ? "**5.** Once the user confirms, apply the decisions with `move_application_status`: accepted items to `shortlisted`, rejected ones to `dismissed`. Move only what they explicitly approved. Never delete an opportunity here — closing keeps it in the de-duplication set so it is never proposed again, whereas deleting loses that memory."
          : `**5.** ${missingScopeNotice("change statuses", SCOPES.applicationsWrite)}\nPresent your recommendations for the user to apply in the app.`,
        scopes.write
          ? "**6.** Where your judgement differs materially from the score already on an opportunity, or where you established something the original proposal missed, call `assess_job_match` to record it. Each call is kept as attributed history alongside the earlier one, so the user can see that a judgement changed and why — do not use it to quietly restate a score you agree with, and do not use it on items you just closed."
          : "",
      ].filter((step) => step !== "");

      return textPrompt(steps.join("\n\n"));
    },
  );
}
