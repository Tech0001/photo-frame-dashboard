# Evergreen progress dashboard

Agents → Evergreen shows one compact card per checklist section. Tap a card to see its
subtasks and statuses; tap a subtask for its owner, next action, stage flags and
short milestone status list. Local evidence documents are not reproduced here.

Percentage = checked subtasks / total subtasks, rounded to a whole percent.
Section percentages count directly checked subtasks, without averaging their
partial progress. A subtask with its own checklist uses the same calculation;
a leaf is done or not done. Unchecked work contributes zero. Build, review,
integration and milestone reports do not earn percentage credit.

Each card and subtask shows today/yesterday change in percentage points from
dated checkbox baselines. No baseline means unknown change. A changed checklist
size/revision requires a matching baseline. At 100%, the item's completed status
must agree with its checkboxes. No agent scoring or weighting is involved.

The source adapter supplies each section's items and coverage. Full coverage establishes the
denominator; optional totalItems can establish the size of a partially reported
checklist. Without a reliable denominator, the card shows a dash and labels the
reported subset. Legacy overview scopes provide titles and stage details, never
invented subtask percentages. Overlapping scopes are grouped under their section.

What changed groups the source's dated recent entries into Today, Yesterday and
Earlier. Reconciliation and publisher receipt do not invent dated achievements.
Needs you and blockers remain accessible alongside the cards. Open details and
scroll positions survive refresh; stale source and transport warnings remain.

See the [feed contract](../tools/project-progress/README.md#finer-checklist-detail-in-the-same-feed).

This repository contains display code, layout styles, the feed contract and generic
test examples only. Live project data is supplied separately and must not be committed.
