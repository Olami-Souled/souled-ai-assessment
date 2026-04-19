# Handoff: AI SO/STAM Assessment System

Quick context for picking up in a new Claude Code session.

## Status as of 2026-04-19

**Everything is deployed and working end-to-end.** The scheduled agent runs daily at 7:03 AM Asia/Jerusalem. Manual test-run successfully queried Salesforce, processed touchpoints, and is in progress. The criteria doc was just expanded (see below).

## What's live

| Piece | Location |
|---|---|
| Salesforce custom fields (14) | Contact object, permission set `Souled_AI_Assessment_Admin` |
| MCP server | https://souled-sf-mcp-production.up.railway.app (Railway project `souled-sf-mcp`) |
| MCP connector on claude.ai | "Souled Salesforce" — URL with `?k=<token>` auth |
| Scheduled remote trigger | `trig_01JNWzHfsEJ3KBnXsNNm7jyq`, cron `3 4 * * *` UTC (7:03 AM Jerusalem) |
| GitHub repos | `Olami-Souled/souled-ai-assessment`, `Olami-Souled/souled-sf-mcp`, `Olami-Souled/souled-coach-outcomes` |

## Assessment criteria (latest)

The DAILY_TASK.md in this repo defines a 4-check model:
1. **Halachically Jewish** (per Orthodox standards — and trust notes over field values; coach once wrongly assumed an adopted student was Jewish)
2. **Was NOT observant** at program start
3. **IS observant now**
4. **Souled drove the transformation**

All four must pass for "Likely Genuine". The agent reads:
- Contact fields (Halachically_Jewish__c, Mother_s_Jewish_status__c, Affiliation__c, etc.)
- All Touch_Point__c records (comments are authoritative)
- All Relationship__c records
- All Coach_Supervision__c records
- All Olami_Activity_Engagement__c records (trip/event notes)

## What's left to build

1. **Manager Salesforce list view** for unconfirmed assessments
   - Filter: `AI_SO_Verdict__c != null AND SO_Confirmed__c = false`
   - Same for STAM
   - Sort: verdict (Unlikely first), then confidence desc
2. **Before-save Flow** to auto-populate `SO_Confirmed_By__c` + `SO_Confirmed_Date__c` when manager ticks the confirmed box
3. **Dashboard integration** — add "Show only confirmed SO/STAM" toggle to the souled-coach-outcomes dashboard (follow-up)

## Critical files to read when resuming

```
instructions/DAILY_TASK.md       # the assessment prompt the agent runs
../souled-sf-mcp/server.py       # the MCP server implementation
../souled-sf-mcp/sf_auth.py      # Salesforce auth with refresh token
sf-metadata/force-app/...        # all 14 field definitions
```

## Credentials stored

- Railway env vars on souled-sf-mcp service: `SF_CLIENT_ID`, `SF_CLIENT_SECRET`, `SF_REFRESH_TOKEN`, `SF_INSTANCE_URL`, `MCP_BEARER_TOKEN`
- User's Railway account token: stored in user's head, regenerate at railway.com/account/tokens if needed

## How to re-test

1. Open the scheduled agent: https://claude.ai/code/scheduled/trig_01JNWzHfsEJ3KBnXsNNm7jyq
2. Click "Run now"
3. Watch the session output
4. Verify in Salesforce with:
   ```sql
   SELECT Id, Name, AI_SO_Verdict__c, AI_SO_Confidence__c, AI_SO_Assessed_Date__c
   FROM Contact
   WHERE AI_SO_Assessed_Date__c = TODAY
   ORDER BY AI_SO_Assessed_Date__c DESC
   ```
