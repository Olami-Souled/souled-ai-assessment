# Souled AI Assessment

AI-assisted verification of SO (Shomer Shabbos) and STAM (Shomer Torah and Mitzvos) outcomes in the Olami/Souled Salesforce org.

## What it does

Every day at 7am, a **remote scheduled Claude Code agent** runs the instructions in `instructions/DAILY_TASK.md`. The agent:

1. Queries Salesforce (via MCP connector) for students with `Shabbos_Observant__c = 'Became'` or `STAM__c = 'Became'` that have not yet been AI-assessed
2. For each student, pulls full coaching context (touchpoints, relationships, engagement)
3. Applies the SO or STAM criteria and produces a verdict: **Likely Genuine / Needs Review / Unlikely / Insufficient Data** with reasoning
4. Writes the assessment back to the Contact via the SF connector (`AI_SO_*` / `AI_STAM_*` fields)

A coach manager reviews pending assessments in Salesforce list views and confirms (or reverts) each via the `SO_Confirmed__c` / `STAM_Confirmed__c` checkboxes.

## Architecture

```
Remote scheduled Claude Code agent (daily, cloud)
  |
  +-- clones this repo
  +-- reads instructions/DAILY_TASK.md
  +-- uses Salesforce MCP connector to query and update Contact records
  +-- processes up to 20 students per run, writes assessments back
  |
  v
Salesforce Contact gets AI_*_Verdict, AI_*_Confidence, AI_*_Assessment, AI_*_Assessed_Date
  |
  v
Manager reviews in SF list view, ticks SO_Confirmed__c / STAM_Confirmed__c
```

No hosted server, no local machine dependency, no Anthropic API credits (runs on Max plan via the scheduled-agents system).

## Salesforce fields (already deployed)

Deployed via `sf-metadata/` using `sf project deploy start`. Permission set `Souled_AI_Assessment_Admin` grants access.

For each of SO and STAM (14 fields total):

| API Name | Type | Purpose |
|---|---|---|
| `AI_<M>_Assessment__c` | Long Text (32768) | Claude's full reasoning |
| `AI_<M>_Verdict__c` | Picklist | Likely Genuine / Needs Review / Unlikely / Insufficient Data |
| `AI_<M>_Confidence__c` | Number (0-100) | Model confidence |
| `AI_<M>_Assessed_Date__c` | Date/Time | When the assessment ran |
| `<M>_Confirmed__c` | Checkbox | Manager ticks when verified |
| `<M>_Confirmed_By__c` | Lookup(User) | Auto-set by Flow (to do) |
| `<M>_Confirmed_Date__c` | Date/Time | Auto-set by Flow (to do) |

Where `<M>` = `SO` or `STAM`.

## Repository layout

```
souled-ai-assessment/
├── README.md                        # This file
├── instructions/
│   └── DAILY_TASK.md                # The prompt the scheduled agent runs
└── sf-metadata/                     # Salesforce custom fields + permission set
    └── force-app/main/default/...
```

The agent only needs `instructions/DAILY_TASK.md`. The `sf-metadata/` directory is retained for reproducibility (to re-deploy fields to another org or restore after changes).

## Running manually (from this machine, for testing or backfill)

You can ask any Claude Code session (or Claude web) to read `instructions/DAILY_TASK.md` and execute it. With the Salesforce MCP connector active, it will run the full loop.

## Scheduled agent

Configured via the `schedule` skill in Claude Code. Runs daily at 7:00 AM Asia/Jerusalem time (= 4:00 AM UTC). See the claude.ai scheduled-agents dashboard for status and logs.

## Related

- `../souled-coach-outcomes/` — the dashboard that surfaced the data quality problem
- `../souled-coach-outcomes/fishy_final.json` — 224 students flagged by initial analysis (scheduled agent will assess these naturally as part of its first runs)
