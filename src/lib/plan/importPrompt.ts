/**
 * The copy-paste prompts the user runs in their own AI (ChatGPT, Claude, …). Two
 * paths, one output: a `plan.due` file Due imports.
 *
 *  - `PLAN_IMPORT_PROMPT` — "I have a plan": convert ANY existing plan (a coach's
 *    spreadsheet, a PDF, a website, a screenshot) into Due's format, faithfully.
 *  - `PLAN_DESIGN_PROMPT` — "I need a plan": interview the runner, then design a
 *    plan and emit it in the same format.
 *
 * Both share the FORMAT + OUTPUT blocks so the contract stays in one place. The
 * JSON shape is the relative (dateless) v3 `.due` format that
 * `normalizeRelativePlan` (`./relative.ts`) validates against — workouts keyed by
 * (week, day), never calendar dates. Due asks the runner for their start/race
 * date at install and computes every calendar date itself. The FORMAT block IS
 * the format's public documentation: keep it in exact sync with the parser.
 */

export const DUE_PLAN_FORMAT = `DUE PLAN FORMAT (JSON):
{
  "formatVersion": 3,                       // REQUIRED — always exactly 3
  "source": "import",
  "plan": {
    "name": "Chicago Marathon Build",       // the plan / goal name (NOT a race date)
    "distanceKind": "marathon",             // one of: marathon | half | 10k | 5k | custom
    "goalTimeSeconds": 12600,               // OPTIONAL — goal finish time in SECONDS, or null
    "numWeeks": 18,                          // total number of weeks in the plan
    "minWeeks": 12                           // OPTIONAL — fewest weeks that still works if the runner starts late
  },
  "weeks": [                              // OPTIONAL — the coach's weekly volume + phase, if the plan states them
    { "week": 1, "phase": "base", "targetMeters": 64374 },
    { "week": 2, "phase": "base", "targetMeters": 72420, "qualityTargetMeters": 0, "longTargetMeters": 22530, "isRecovery": false }
    // ...one per week; "week" is 1-based; phase: base | build | peak | taper | recovery
  ],
  "workouts": [
    {
      "week": 1,                            // 1-based week number (NOT a date)
      "day": 0,                             // day of week: 0=Mon 1=Tue 2=Wed 3=Thu 4=Fri 5=Sat 6=Sun
      "type": "easy",                       // one of: easy | long | quality | rest | cross | race
      "title": "Easy 5 mi",                 // short name
      "plannedDistanceMeters": 8047,        // distance in METERS (1 mile = 1609, 1 km = 1000)
      "notes": "Easy and conversational — recovery, not training.",  // OPTIONAL — a short coaching cue; see RULES
      "structure": [                        // OPTIONAL — add to attach pace/effort/HR or shape a session
        { "kind": "warmup", "target": { "distance_m": 1600, "hr_zone": "easy" } },
        { "kind": "repeat", "sets": 6, "children": [
          { "kind": "interval", "target": { "distance_m": 800, "hr_zone": "interval", "pace": { "kind": "absolute", "band": { "fast_s_per_km": 248, "slow_s_per_km": 258 }, "intent": "5K" } } },
          { "kind": "recovery", "target": { "distance_m": 400, "hr_zone": "easy" } }
        ] },
        { "kind": "cooldown", "target": { "distance_m": 1600, "hr_zone": "easy" } }
      ]
    }
    // ...one object per training day across the WHOLE plan, ordered by week then day
  ]
}

RULES:
- Workouts are positioned by "week" (1-based) and "day" (0=Monday 1=Tuesday 2=Wednesday 3=Thursday 4=Friday 5=Saturday 6=Sunday). Never emit calendar dates — Due asks the runner for their start or race date when they install and computes every date itself. A workout with no valid week/day is rejected on import, so give every workout both.
- All distances are in METERS. Work out whether the source is in miles or kilometers FIRST (ask if it's unclear), then convert: miles ×1609, km ×1000.
- If you have a code tool (Python, etc.), USE IT for the deterministic work: do the unit conversions and check each week's listed workouts against its target, then build the JSON from those results. Doing this by hand across a long plan is where a week's sum comes out wrong.
- "type": "quality" = anything with intervals / tempo / threshold / speed work; "long" = the weekly long run; "easy" = easy or recovery runs; "rest", "cross" (cross-training), "race" as applicable. Put the goal race in the FINAL week ({ "type": "race" }).
- One workout object per training day. Include rest days as { "type": "rest" } only if the plan explicitly calls them out; otherwise omit non-running days.
- Two runs in one day — a "double" (some runners do an easy run in the morning and a harder session in the evening): emit TWO workout objects with the same "week" and "day".
- "structure" is OPTIONAL but it's how you attach PACE / EFFORT / HR and shape a session — an ordered array of segments:
    - "kind": warmup | cooldown | steady | interval | work | recovery | strides | repeat. A "repeat" has "sets" (count) + "children" (an ordered array of the other kinds).
    - each segment has a "target" with any of: "distance_m" (meters), "duration_s" (seconds — for time-based reps like 5×3min), ONE "pace" prescription, "hr_zone", or "effort" (free text). Include only what the plan actually prescribes.
    - A RELATIVE pace preserves portable coaching intent: { "pace": { "kind": "relative", "reference": "MP", "speed_fraction": 0.92 } }. "speed_fraction" is explicitly a fraction of SPEED: 0.92 is slower than MP; 1.10 is faster. It is REQUIRED even for an unmodified reference (use 1.0).
    - An ABSOLUTE pace preserves a numeric prescription: { "pace": { "kind": "absolute", "band": { "fast_s_per_km": 248, "slow_s_per_km": 258 }, "intent": "5K" } }. Both bounds are REQUIRED in seconds per km; for an exact point pace, set them equal. "intent" is optional context and never overrides the numbers.
    - Pace references/intents: MP | HMP | 10K | 5K | 3K | mile | threshold | tempo | easy | steady | rep | recovery. "hr_zone": easy | steady | threshold | interval | rep.
    - Relative and absolute are mutually exclusive. If the source states a relationship ("92% MP"), use relative. If it ALSO prints an example clock pace for that relationship ("92% MP (6:33/mi)"), keep the relationship as the machine-readable target and preserve the example in "notes"; do not turn it into a competing absolute target. If the source states only a numeric pace or band, use absolute. Never invent a relationship from a number or replace a stated relationship with a guessed number.
- Capture intensity even on a plain run by giving it ONE segment: a marathon-pace long run = [{ "kind": "steady", "target": { "distance_m": 26000, "pace": { "kind": "relative", "reference": "MP", "speed_fraction": 1.0 } } }]; an easy day by heart rate = [{ "kind": "steady", "target": { "hr_zone": "easy" } }]. A structured long run "4mi easy / 10mi @ 92% MP / 2mi easy" = three segments; only the middle segment carries the relative MP prescription.
- Keep "title" a short human name ("6×800m @ 5K", "MP long run"); the structure carries the machine-readable detail. (A title like "4×800m @ 5K" alone will still be parsed, but structure is preferred.)
- "notes" is OPTIONAL — one short line of coaching for this workout (its intent, or how to run it) that shows when I open the workout. Write it as a cue or a statement, NEVER a question or anything that expects a reply (Due can't answer). Keep it under ~200 characters; omit it rather than pad with filler.
- "weeks" is OPTIONAL. If the plan states a weekly mileage TARGET (the headline number a coach watches), include it per week in METERS with the phase (use "week", 1-based). The target is authoritative and CAN be higher than the listed days — Due treats the difference as easy fill miles (a week is judged on total weekly mileage, not on running exactly the listed sessions). Don't pad fake workouts to match the number; just state the target. Omit "weeks" entirely and Due sums the days instead.
- If something non-critical is missing (no goal time), still produce the file with those as null, and note what you assumed in a top-level "questions" array, e.g. "questions": ["Assumed a marathon; no goal time given"].`;

const DUE_PLAN_OUTPUT = `OUTPUT:
Give me the plan two ways so I can pick whichever is easier on my phone:
1. Write the JSON to a downloadable file named "plan.due" (UTF-8 text) using your code/file tool — in ChatGPT write it to plan.due with Python and provide the download; in Claude create it as a file. The filename MUST end in .due, not .txt or .json.
2. ALSO print the exact same JSON in a single copyable code block, so I can select it and share it straight to Due.
Either the plan.due file or the copied JSON block is what I bring into Due.`;

export const PLAN_IMPORT_PROMPT = `You are converting a running training plan into the import format for "Due", an iOS running app. Read the plan I paste at the bottom and convert it to Due's JSON format using the rules below. Convert it faithfully — don't redesign it or invent workouts. If I didn't actually include a plan below, ask me for it instead of making one up.

Before you convert, one thing the file MUST get right: every distance must be in the correct unit. If it's unclear whether distances are in miles or kilometers, ASK which and wait for my answer before converting. If the source plan is date-based (real calendar dates, or a start date plus positions), convert those dates to week/day positions relative to the plan's FIRST week — week 1 is the first training week, and day 0=Monday … 6=Sunday. Due will ask me for my start or race date when I install, so the file itself carries no dates. If the plan already gives week/weekday positions and clear units, just convert it. (A short line of framing around the file is fine; don't alter the plan's data.)

${DUE_PLAN_FORMAT}

${DUE_PLAN_OUTPUT}

Here is my plan to convert:
`;

export const PLAN_DESIGN_PROMPT = `You are designing a running training plan WITH me, then exporting it for "Due", an iOS running app. Don't build anything yet — first interview me. Ask a few questions at a time to learn:
- my goal race and its distance (and, if I have one in mind, roughly when it is or when I want to start)
- my recent weekly mileage and longest recent run — tell me whether you're using miles or km
- how many days a week I can run, and which day suits my long run
- my goal finish time, if I have one
- anything else that matters (injuries, workouts I like, tune-up races)
Wait for my answers. There are two kinds of gaps. HARD gaps you CANNOT build without — my current weekly mileage, and whether I use miles or km — if either is missing, ask again; never invent or assume them. SOFT gaps that still shape the plan a lot — my race or start date (worth asking, but the plan itself carries no dates; Due asks me for the date and anchors the weeks when I install), my long-run day, whether I ever run twice in one day (a "double"), my exact days per week, my goal time — ask about these too; you can proceed without them, but the plan is better with them. Clearing the hard gaps is not a reason to stop interviewing — keep going until you can build it WELL, not just safely. Then design a sensible, progressive plan — a gradual weekly build with recovery/cutback weeks and a taper into race week, matched to what I told you — and output it in Due's format below. Show me a quick summary, then give me the plan.due file (see OUTPUT).

${DUE_PLAN_FORMAT}

${DUE_PLAN_OUTPUT}
`;
