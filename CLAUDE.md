## Shared knowledge — Olami/Souled wiki

Before answering any domain question about Contact fields, SO/STAM
classification, or Olami-Souled program concepts, read
`~/knowledge/wiki/index.md` first. Then drill into the specific concept
pages most relevant to this repo:

- `~/knowledge/wiki/concepts/contact.md` — the Contact object, including
  the canonical SO date field.
- `~/knowledge/wiki/concepts/so-stam-assessment.md` — AI + manager-confirmed
  SO/STAM fields, status transitions, common query patterns.
- `~/knowledge/wiki/concepts/api-name-typos.md` — do NOT "fix" names like
  `Current_Growth_Cyvle_Focus__c` or `Manual_Referrrer__c`.

Treat the wiki as authoritative. Hard rules relevant here:

- `Date_Became_SO__c` is the canonical SO date. `SO_Date__c` and
  `Date_Became_Shabbos_Observant__c` do not exist.
- Test-record exclusion: `Test_Old__c = false AND NOT Name LIKE '%test%'`.
- Case-sensitive JSON callers: `Months_in_Seminary__c` (lowercase `i`) in
  REST responses vs. `Months_In_Seminary__c` in metadata.

If a claim in this repo disagrees with the wiki, the wiki wins. If a topic
that comes up here isn't in the wiki, flag it.
Wiki repo: github.com/Olami-Souled/knowledge.