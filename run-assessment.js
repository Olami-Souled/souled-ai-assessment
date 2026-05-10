#!/usr/bin/env node
'use strict';

// GHA replacement for the Claude Code SO/STAM assessment routine.
// Finds unassessed students with Shabbos_Observant__c = 'Became' or
// STAM__c = 'Became', gathers full Salesforce context per student,
// runs the 4-check assessment via claude-opus-4-7, and writes results back.

const Anthropic = require('@anthropic-ai/sdk');
const jsforce = require('jsforce');

const PROCESS_ID = 'trig_01JNWzHfsEJ3KBnXsNNm7jyq';
const BASE_URL = process.env.BASE_URL || 'https://bina.olami.org';

const SYSTEM_PROMPT = `You are an AI assessor for Olami Souled. You will be given a student's complete Salesforce coaching data and must apply the 4-check criteria to determine if their SO or STAM milestone label is genuine.

4-CHECK CRITERIA (all four must pass for Likely Genuine):
1. HALACHICALLY JEWISH: Mother_s_Jewish_status__c = Jewish AND Halachically_Jewish__c = Yes. Trust touchpoint and supervision NOTES over field values -- look for adoption, lineage uncertainty, or any hint she is not halachically Jewish.
2. WAS NOT OBSERVANT at program start: Earliest touchpoints show a non-observant starting point. Red flags: Affiliation = Orthodox with no journey narrative; earliest TPs already describe mitzvah observance.
3. IS OBSERVANT NOW (through Souled): Latest touchpoints and supervision notes confirm current observance. For SO: keeping Shabbat halachically. For STAM: full observance (kashrut, davening, holidays, tzniut).
4. SOULED DROVE THE CHANGE: Coaching caused the transformation, not a pre-existing trajectory via family, school, or another program.

Verdicts: Likely Genuine / Needs Review / Unlikely / Insufficient Data
STAM requires a strictly higher bar than SO -- when in doubt, prefer Needs Review.

Respond with EXACTLY this format (ASCII only -- no em-dashes, no bullets, no unicode):

VERDICT: <Likely Genuine|Needs Review|Unlikely|Insufficient Data>
CONFIDENCE: <0-100>

4-CHECK SUMMARY:
  1. Halachically Jewish: <Yes/Questionable/No> - <one sentence>
  2. Was NOT observant at start: <Yes/Unclear/No> - <one sentence>
  3. IS observant now: <Yes/Unclear/No> - <one sentence>
  4. Souled drove it: <Yes/Partial/No> - <one sentence>

SUMMARY:
<2-3 paragraph narrative addressing all 4 checks>

KEY SIGNALS:
  * <signal 1>
  * <signal 2>
  * <signal 3>

RED FLAGS:
  [!] <flag 1, or "None" if none>`;

async function loginSF() {
  const conn = new jsforce.Connection({ loginUrl: 'https://login.salesforce.com' });
  await conn.login(
    process.env.SF_USERNAME,
    (process.env.SF_PASSWORD || '') + (process.env.SF_SECURITY_TOKEN || '')
  );
  return conn;
}

async function gatherContext(sf, id) {
  const [contact, touchpoints, relationships, supervisions, engagements] = await Promise.all([
    sf.query(`SELECT Id, Name, Age__c, Country__c, Affiliation__c,
        Halachically_Jewish__c, Mother_s_Jewish_status__c, Father_s_Jewish_status__c,
        CreatedDate, Registered_for_souled__c, Souled_Alumni__c, Souled_Status__c,
        Shabbos_Observant__c, STAM__c, Keeps_tzniut__c, Committed_to_marry_jewish__c,
        Date_Became_SO__c, Months_In_Seminary__c,
        Touch_Points__c, Interactions__c, Total_Attendances__c,
        Active_Coaching_Relationships__c, Days_Since_Last_Meeting__c
      FROM Contact WHERE Id = '${id}'`),
    sf.query(`SELECT Touch_Point_Date__c, Touch_Point_Type__c, Duration__c,
        Meeting_Primary_Subject__c, Growth_Steps_Category__c,
        Comment__c, What_s_working_well__c, What_s_not_working_well__c,
        What_s_the_next_step__c, Reported_By__r.Name
      FROM Touch_Point__c WHERE Student__c = '${id}'
      ORDER BY Touch_Point_Date__c ASC`),
    sf.query(`SELECT Mentor__r.Name, Status__c, Start_Date__c, End_Date__c,
        Touch_Points__c, Type__c, End_Reason__c
      FROM Relationship__c WHERE Student__c = '${id}'
      ORDER BY Start_Date__c ASC`),
    sf.query(`SELECT Supervision_Date__c, Supervision_Type__c, Supervisor__r.Name,
        What_s_working_well__c, What_s_not_working_well__c,
        What_s_the_next_step__c, Supervision_Notes__c
      FROM Coach_Supervision__c WHERE Student__c = '${id}'
      ORDER BY Supervision_Date__c ASC`),
    sf.query(`SELECT Id, Status__c, Notes__c, Coach_recommends__c,
        Emersive_Learning_Experience__r.Title__c,
        Emersive_Learning_Experience__r.Type__c,
        Emersive_Learning_Experience__r.Start_Date__c
      FROM Olami_Activity_Engagement__c WHERE Student__c = '${id}'
      ORDER BY Emersive_Learning_Experience__r.Start_Date__c ASC`),
  ]);
  return {
    contact: contact.records[0],
    touchpoints: touchpoints.records,
    relationships: relationships.records,
    supervisions: supervisions.records,
    engagements: engagements.records,
  };
}

function formatContext({ contact: c, touchpoints, relationships, supervisions, engagements }, metric) {
  const lines = [
    `=== ${c.Name} -- ${metric} Assessment ===`,
    ``,
    `CONTACT FIELDS:`,
    `  Halachically_Jewish__c: ${c.Halachically_Jewish__c}`,
    `  Mother_s_Jewish_status__c: ${c.Mother_s_Jewish_status__c}`,
    `  Father_s_Jewish_status__c: ${c.Father_s_Jewish_status__c}`,
    `  Affiliation__c: ${c.Affiliation__c}`,
    `  Shabbos_Observant__c: ${c.Shabbos_Observant__c}`,
    `  STAM__c: ${c.STAM__c}`,
    `  Keeps_tzniut__c: ${c.Keeps_tzniut__c}`,
    `  Date_Became_SO__c: ${c.Date_Became_SO__c}`,
    `  Months_In_Seminary__c: ${c.Months_In_Seminary__c}`,
    `  Souled_Status__c: ${c.Souled_Status__c}`,
    `  Touch_Points__c (count): ${c.Touch_Points__c}`,
    `  CreatedDate: ${c.CreatedDate}`,
    ``,
    `TOUCHPOINTS (${touchpoints.length} total):`,
  ];
  for (const tp of touchpoints) {
    lines.push(`  [${tp.Touch_Point_Date__c}] ${tp.Touch_Point_Type__c || ''} (${tp.Duration__c || '?'}min) - ${tp.Meeting_Primary_Subject__c || ''} / ${tp.Growth_Steps_Category__c || ''}`);
    if (tp.Comment__c) lines.push(`    Comment: ${tp.Comment__c.slice(0, 500)}`);
    if (tp.What_s_working_well__c) lines.push(`    Working well: ${tp.What_s_working_well__c.slice(0, 300)}`);
    if (tp.What_s_not_working_well__c) lines.push(`    Not working: ${tp.What_s_not_working_well__c.slice(0, 300)}`);
    if (tp.What_s_the_next_step__c) lines.push(`    Next step: ${tp.What_s_the_next_step__c.slice(0, 200)}`);
  }
  lines.push(``, `COACHING RELATIONSHIPS:`);
  for (const r of relationships) {
    lines.push(`  ${r.Mentor__r?.Name || 'Unknown'}: ${r.Status__c} ${r.Start_Date__c} - ${r.End_Date__c || 'ongoing'} (${r.Touch_Points__c || 0} TPs)${r.End_Reason__c ? ` [ended: ${r.End_Reason__c}]` : ''}`);
  }
  lines.push(``, `SUPERVISION NOTES (${supervisions.length} total):`);
  for (const s of supervisions) {
    lines.push(`  [${s.Supervision_Date__c}] ${s.Supervisor__r?.Name || ''}`);
    if (s.Supervision_Notes__c) lines.push(`    Notes: ${s.Supervision_Notes__c.slice(0, 500)}`);
    if (s.What_s_working_well__c) lines.push(`    Working: ${s.What_s_working_well__c.slice(0, 300)}`);
    if (s.What_s_not_working_well__c) lines.push(`    Not working: ${s.What_s_not_working_well__c.slice(0, 300)}`);
  }
  lines.push(``, `ACTIVITY ENGAGEMENTS (${engagements.length} total):`);
  for (const e of engagements) {
    const exp = e.Emersive_Learning_Experience__r;
    lines.push(`  ${exp?.Title__c || 'Unknown'} (${exp?.Type__c || ''}, ${exp?.Start_Date__c || ''}) - ${e.Status__c || ''}`);
    if (e.Notes__c) lines.push(`    Notes: ${e.Notes__c.slice(0, 300)}`);
  }
  return lines.join('\n');
}

function parseAssessment(text) {
  const verdictMatch = text.match(/^VERDICT:\s*(.+)/m);
  const confMatch = text.match(/^CONFIDENCE:\s*(\d+)/m);
  return {
    verdict: verdictMatch?.[1]?.trim() || 'Needs Review',
    confidence: parseInt(confMatch?.[1] ?? '50'),
    text: text.slice(0, 32000),
  };
}

async function writeAssessment(sf, studentId, metric, { verdict, confidence, text }) {
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, '.000+0000');
  const fields = metric === 'SO'
    ? { AI_SO_Verdict__c: verdict, AI_SO_Confidence__c: confidence, AI_SO_Assessment__c: text, AI_SO_Assessed_Date__c: now }
    : { AI_STAM_Verdict__c: verdict, AI_STAM_Confidence__c: confidence, AI_STAM_Assessment__c: text, AI_STAM_Assessed_Date__c: now };
  await sf.sobject('Contact').update({ Id: studentId, ...fields });
}

async function sendHeartbeat(status, summary) {
  const key = process.env.PROCESS_HEARTBEAT_KEY;
  if (!key) return;
  try {
    await fetch(`${BASE_URL}/api/admin/processes/${PROCESS_ID}/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-heartbeat-key': key },
      body: JSON.stringify({ status, summary }),
    });
  } catch { /* best effort */ }
}

async function run() {
  const [sf, ai] = [await loginSF(), new Anthropic()];

  const [soResult, stamResult] = await Promise.all([
    sf.query(`SELECT Id, Name FROM Contact WHERE Shabbos_Observant__c = 'Became' AND AI_SO_Assessed_Date__c = null AND Test_Old__c = false AND (NOT Name LIKE '%test%') ORDER BY CreatedDate DESC LIMIT 10`),
    sf.query(`SELECT Id, Name FROM Contact WHERE STAM__c = 'Became' AND AI_STAM_Assessed_Date__c = null AND Test_Old__c = false AND (NOT Name LIKE '%test%') ORDER BY CreatedDate DESC LIMIT 10`),
  ]);

  const pairs = [
    ...soResult.records.map(s => ({ ...s, metric: 'SO' })),
    ...stamResult.records.map(s => ({ ...s, metric: 'STAM' })),
  ].slice(0, 10);

  if (!pairs.length) {
    console.log('No students need assessment today.');
    await sendHeartbeat('ok', 'No students need assessment today.');
    return;
  }
  console.log(`Assessing ${pairs.length} students...`);

  const counts = {};
  let processed = 0, errors = 0;
  const lines = [];

  for (const { Id, Name, metric } of pairs) {
    try {
      console.log(`  ${Name} (${metric})...`);
      const ctx = await gatherContext(sf, Id);
      const contextText = formatContext(ctx, metric);

      const resp = await ai.messages.create({
        model: 'claude-opus-4-7',
        max_tokens: 3000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: contextText }],
      });

      const assessment = parseAssessment(resp.content.find(b => b.type === 'text')?.text || '');
      await writeAssessment(sf, Id, metric, assessment);
      counts[assessment.verdict] = (counts[assessment.verdict] || 0) + 1;
      processed++;
      console.log(`    -> ${assessment.verdict} (${assessment.confidence}%)`);
      lines.push(`${Name} (${metric}): ${assessment.verdict} (${assessment.confidence}%)`);
    } catch (err) {
      console.error(`  ERROR ${Name}: ${err.message}`);
      errors++;
      lines.push(`${Name}: ERROR`);
    }
  }

  const lg = counts['Likely Genuine'] || 0;
  const nr = counts['Needs Review'] || 0;
  const ul = counts['Unlikely'] || 0;
  const id = counts['Insufficient Data'] || 0;
  const header = `Processed ${processed} students (${soResult.records.length} SO, ${stamResult.records.length} STAM). Likely Genuine: ${lg}, Needs Review: ${nr}, Unlikely: ${ul}, Insufficient Data: ${id}. Errors: ${errors}.`;
  const summary = lines.length ? `${header}\n\n${lines.join('\n')}` : header;
  console.log(`\n${header}`);
  await sendHeartbeat(errors === pairs.length ? 'error' : 'ok', summary);
}

run().catch(err => { console.error(err); process.exit(1); });
