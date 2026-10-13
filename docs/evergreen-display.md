# Evergreen progress dashboard

Agents → Evergreen shows one compact card per C section. Tap a card to see its
subtasks and statuses; tap a subtask for its owner, next action, stage flags and
short milestone status list. Local evidence documents are not reproduced here.

The percentage uses Ledger’s verified completed/total progress steps, rounded
to a whole percent. Each card and subtask shows today’s and yesterday’s change
in percentage points from dated baselines. Missing counts or baselines stay
visibly unknown. With no incremental counts, a fully reported checklist can
fall back to its completed-item fraction. Underway, blocked, pending and unknown items stay in
the denominator. It is checklist progress, not effort or time remaining. An
achieved milestone does not complete its parent acceptance item.

Ledger supplies each section's items and coverage. Full coverage establishes the
denominator; optional totalItems can establish the size of a partially reported
checklist. Without a reliable denominator, the card shows a dash and labels the
reported subset. Legacy overview scopes provide titles and stage details, never
invented subtask percentages. Overlapping scopes are grouped under their C.

What changed groups the source's dated recent entries into Today, Yesterday and
Earlier. Reconciliation and publisher receipt do not invent dated achievements.
Needs you and blockers remain accessible alongside the cards. Open details and
scroll positions survive refresh; stale source and transport warnings remain.

See the [feed contract](../tools/project-progress/README.md#finer-checklist-detail-in-the-same-feed).
