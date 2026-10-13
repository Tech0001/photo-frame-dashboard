# Evergreen at a glance

**Agents → Evergreen** uses Ledger's reported evidence, never agent activity or
passing tests as an automatic completion rule.

- Four stage bars show how many reported scopes are built, reviewed, integrated,
  and live. These are independent counts; scopes may overlap. They are not an
  overall completion percentage. Pending and unknown remain distinct.
- The delivery map shows each scope's four states. Tap a tile for its full title,
  owner and evidence. Scroll the map to see additional scopes.
- **Today**, **Yesterday**, and **Earlier** group the `recent` entries by their
  actual `at` timestamps in the frame's local calendar day. Receipt time and the
  report's reconciliation timestamp do not move an old event into Today.
- **Needs you** and **Blockers & follow-up** show counts. Tap to reveal titles,
  then tap an item for its details and next action.
- Tap the objective to read the full objective, source and next step.

Details and panel scroll positions survive refresh. Stale-feed and stale-report
warnings stay visible. An empty day says **No completions reported**, not that no
work happened. The source must include the dated recent entries to display them;
retain relevant recent days in Ledger's snapshot when reconciling new reports.
The frame does not invent history or retain withdrawn source claims.

With checklist sections in the existing feed, the overview counts individual
checklist items as completed, underway, pending, or unknown. The section picker
shows each reported section. Partial coverage is labelled **Reported subset**.
Each open item shows achieved milestones separately, with a compact timeline;
tap a milestone for its independent stage evidence, owner and next step. Four
achieved milestones can coexist with an open acceptance item. These counts are
checklist progress, not engineering effort or time remaining.

The older scope display remains supported until Ledger supplies the finer
report. The contract is in [Evergreen progress sync](../tools/project-progress/README.md#finer-checklist-detail-in-the-same-feed).
