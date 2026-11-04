# Vacancy analysis (SystemOne / clef-flash)

Status: design, implementation in progress on `feat/vacancy-analysis`.
Prototype and evidence: branch `proto/systemone-fit`, worktree `/Users/art/Code/otbor-systemone`
(`prototype/FINDINGS-a1.md`, `prototype/systemone-a4.proto.ts` holds the question wording to port).

## What it is

A local decision model (`mlx-community/clef-flash-4bit`) runs on the operator's Mac under omlx. It is not a chat
model: `POST {base}/v1/systemone` takes `{model, state, questions}` and returns, per question, a probability
(`noul` yes/no, `choice` with probabilities per option, `score`) in one forward pass (~3-6 s for ~36 questions,
requests are serialized on the GPU). Auth is a bearer key. Example response shape:

```json
{"answers": {"role": {"type":"choice","choice":"devops","confidence":0.97,"probabilities":{"devops":0.97}},
             "overtime": {"type":"noul","noul":0.03},
             "years_min": {"type":"score","score":2.8,"confidence":0.7}}}
```

## Why

Regex detectors in `packages/domain/src/vacancy-facts.ts` and the title gate miss real requests ("в отклике
расскажите о проектах") and fire on noise ("GitHub Actions" in a stack list, "function calling" read as on-call).
The model fixes both, and it can classify the role and seniority of the ~5000 vacancies the title gate leaves
as `unknown`.

## Evidence that shapes the design (do not re-litigate)

- Wording changes made no difference; answers are 96% stable when other questions change.
- Accuracy depends on model confidence: above 0.8 about 92% correct, below 0.8 about 40%. So every field is
  stored with its confidence and consumers use a threshold, default `0.8`.
- Employer profile text (`employer.description_text`, `category`, `size_category`, `address`, `accredited_it`,
  `industries`) must be in the state for company type. Do not send site URL, logo or badges.
- Stack questions (`stack_*`) are dropped: useless noise, `keyword`/`vacancy_skill` already cover stack.
- Operator labels are noisy; do not tune to them further.

## Scope

Layer A only: facts about the vacancy, independent of the user. Computed once per input, stored in a shared
(readable by all) table, like `vacancy`. Per-user "personal" questions against the resume are out of scope for now.

### Facts (all with confidence; below threshold they read as unknown)

- `isIt`, `role` (devops, sre, platform, sysadmin, security, backend, frontend, fullstack, mobile, qa, data,
  analyst, dba, support, manager, other)
- `titleLevel`, `requiredLevel`: intern, junior, middle, senior, staff, tech_lead, team_lead, head, unknown;
  `yearsMin` (score 0..6); `managesPeople`
- `companyType`: product, outsource, outstaff, integrator, consulting, bank_fintech, government, startup,
  recruiter, unknown. If `employer.category = 'agency'` that wins over the model.
- `workMode` (remote, hybrid, office, unspecified), `employment` (labor_code, contractor, unspecified),
  `locationRequirement`, `internship`
- Application requests, each tri-state `required | preferred | not_mentioned`: coverLetter, repo, portfolio,
  answersInReply, contactOutside, externalForm, salaryExpectation
- `testTask`: none, paid, unpaid, unspecified. `english`: required, preferred, not_mentioned
- Booleans: onCall, nightOrWeekend, overtime, businessTrips, probation, probationUnpaidOrReduced, salaryInText,
  bonus, healthInsurance, educationBudget, soloRole, relocationRequired, citizenshipRequired
- Red flags: stress, multitask, scam, discrimination

## Architecture

Follow `AGENTS.md` conventions. Read `node_modules/effect/AGENTS.md` before writing Effect code.

- `packages/domain` (pure): `analysis/` module with the versioned question catalog (`ANALYSIS_PROMPT_VERSION`),
  the state builder input type, `interpretAnswers(raw, {threshold}) -> VacancyAnalysisFacts`, and
  `mergeTextFacts(regexFacts, analysisFacts) -> VacancyTextFacts` (analysis wins where confident, regex stays the
  fallback). Unit tests with recorded raw answers.
- `packages/contract`: `VacancyAnalysis` schema (facts + `model`, `promptVersion`, `inputHash`, `createdAt`),
  an RPC to read it for a vacancy (and expose it in the vacancy detail), schedule kind `analysis`.
- `packages/cloud`: migration `0025_vacancy_analysis.sql` (hand-written, shared read policy like `vacancy`, owner
  writes), Drizzle schema, `VacancyAnalysisRepository`, `SystemOneClient` (Effect HTTP client; env
  `OTBOR_SYSTEMONE_URL` default `http://127.0.0.1:1111`, `OTBOR_SYSTEMONE_API_KEY`, `OTBOR_SYSTEMONE_MODEL`
  default `clef-flash-4bit`; never log the key), `AnalysisRunner` (bounded pass, oldest first, only vacancies with
  `hydration_status = 'full'` whose analysis is missing or stale by `inputHash`; sequential; aborts the pass
  cleanly with a clear error when the server is unreachable), `ScheduleDispatcher` branch for kind `analysis`.
- `inputHash` = stable hash of the exact state sent (vacancy content hash, employer profile fields used, prompt
  version). A changed employer profile or prompt version makes it stale.
- Decision integration (`packages/domain/src/decision.ts` + `decisionEvaluation.ts`):
  - title gate stays first. If gate is `unknown` and analysis says `isIt` and role in devops/sre/platform with
    confidence >= threshold, the gate result becomes `match` with reason `role_match: analysis (<role> 0.97)`.
    Analysis never overrides a title `reject`.
  - `seniority` is `unknown` for most vacancies: when analysis `requiredLevel` is confident, use it for the
    `VacancySignal` (map staff to senior, tech_lead/team_lead/head to lead).
  - Confident `testTask = unpaid` or a required application request that the account cannot satisfy keeps using the
    existing paths (blocked_test, kit hints); wire analysis facts into those via `mergeTextFacts`.
- Operator surface: CLI `otbor analysis run|stats|show <vacancy>` consuming the RPC group (no second API), and the
  web vacancy page shows the facts compactly with confidence (low confidence rendered as unknown).
- Observability: `Effect.log*` only, per-pass counters in `schedule_run.detail`.

## Out of scope

Personal fit against the resume, multi-user model settings, batching/parallelism on the GPU, fine-tuning.

## Done means

Typecheck and tests green, migration applied, a manual `otbor analysis run` analyses real vacancies, the decision
step uses it, the web page shows it, committed on the branch.
