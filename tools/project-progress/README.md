# Evergreen progress sync

The frame's **Agents → Evergreen** page displays explicit reports from the
project's maintained records. It does not turn lane activity, commits or passing
tests into claims about project completion. Account usage remains in **Usage**.

## Ledger handoff

Ledger owns the source adapter: choose the canonical Evergreen countdown/Plane
records and export the selected fields below. The frame adapter, authenticated
endpoint and five-minute publisher are ready. No changes to Orrery are needed.

1. Read the canonical source, not conversation snippets. Map its explicit built,
   reviewed, integrated/landed and deployed/live evidence separately. A passing
   build does not establish review, integration or deployment. Use `null` where
   the source does not establish a stage, and `false` for explicitly pending work.
2. Include the current objective, meaningful recent completions, plain-English
   blockers (owner and next action), and decisions explicitly assigned to the
   Director. Do not infer blockers, completion or decisions from agent silence.
3. Produce one complete JSON report on stdout from a deterministic exporter, or
   atomically replace a report file. Use the actual source observation time as
   `updatedAt`; preserve old timestamps when replaying a cached report. An
   exporter must fail if it cannot read its source rather than invent fresh data.
4. Configure and test the publisher, then enable its timer. No model calls are
   needed to transport reports. If summarization is needed, maintain those
   summaries in the owning progress records before exporting them.

Only selected short display text and stage flags leave the source machine.
Raw memories, transcripts, evidence objects, credentials and local paths must
not be placed in the display fields. The publisher and hub discard additional
fields; they cannot detect a secret embedded in an approved title or detail.
Reports are visible to the household network. Keep the hub on that network.

## Contract

`PUT /api/progress/evergreen` requires `Content-Type: application/json` and a
dedicated `X-Progress-Token`. There is no unauthenticated-write fallback, even
before a token is configured. `GET` returns the selected report and hub receipt
time. Reports replace the complete previous report. Older `updatedAt` values
are rejected; validation failures preserve the last good report.

Existing report fields (accepted with `schemaVersion: 1` or `2`):

| Field | Meaning and limit |
| --- | --- |
| `schemaVersion`, `project` | `1` or `2`, and `"evergreen"` |
| `source` | Source/owner display label, required, 80 characters; no path |
| `updatedAt` | ISO timestamp with timezone; source observation time |
| `objective` | Required current objective, 300 characters |
| `next` | Next project action, optional, 400 characters |
| `work`, `recent`, `blockers`, `decisions` | Required arrays, at most 24 items each; empty means no items reported |

All items require a unique stable `id` (1–60 letters, numbers, `.`, `_`, `-`)
and `title` (1–180 characters). Optional `owner` and `detail` allow 60 and 400
characters. These are plain text, never rendered as HTML.

- **work:** `stages` contains independently reported `built`, `reviewed`,
  `integrated` and `live`: `true`, `false` or `null`. Omitted stages become null.
- **recent:** `stage` is one of those four names; `at` is the actual completion
  timestamp, no newer than `updatedAt`. Supply newest items first.
- **blockers/decisions:** optional `next` (300 characters) states the next action
  or requested decision. A blocker assigned to an agent belongs in blockers;
  only decisions/actions explicitly requiring the Director belong in decisions.

Timestamps may be at most five minutes ahead of the hub. The frame warns when
the publisher has not checked in for 15 minutes or the source report is over
24 hours old. Sending an unchanged report is a heartbeat, not new progress:
it refreshes receipt time but never its source timestamp. Read failures retain
the last report with a connection warning. The frame checks this local hub
endpoint once a minute while Evergreen is visible; it does not poll Plane or
agent systems itself.

## Finer checklist detail in the same feed

The same snapshot file, endpoint and timer accept checklist sections. This is an
extension of the existing feed, not a second feed. Set `schemaVersion: 2` and
`publishable: true` only in the reconciled live snapshot. A report containing
`publishable: false` or `proposalVersion` is rejected. Keep proposals separate.

Keep all existing envelope fields and arrays; `work` may be empty when sections
supply the finer display. Add `sections`, with 1–16 entries:

- Section: stable `id`, `title` (180 characters), `coverage` (`partial` or
  `complete`), optional `totalItems` (integer, maximum 128), and `items`. Coverage describes whether all checklist items in
  that section were reported, not whether the section is finished.
- Item: stable `id` such as `C12.7`, `title`, `status`, `checklistChecked`,
  `owner`, `detail`, `next`, `acceptance`, `stages`, `stageEvidence`, `milestones`.
- Milestone: stable `id`, `title`, `status`, `owner`, `detail`, `next`, `stages`,
  `stageEvidence`, and `at` (actual achievement timestamp or `null`).

Statuses are exactly `completed`, `underway`, `blocked`, `pending`, or `unknown`.
`checklistChecked` is required and must be true exactly when the parent item is
completed. The section percentage is completed items / total checklist items.
With complete coverage, the item list supplies the total. With partial coverage,
provide totalItems from the authoritative checklist to establish its full size;
otherwise the frame shows no percentage. totalItems must be at least the reported
item count, and must equal it for complete coverage. Unreported remaining items
are not silently completed. Achieved milestones never close their parent automatically. Stages
remain independent boolean/null flags; `stageEvidence` has optional short text
for each of `built`, `reviewed`, `integrated`, and `live`. Integration evidence
should state its scope, for example offline composition versus landed code.

Item/milestone text limits: title 180, owner 120, detail 500, next 400; item
acceptance 600; each stage evidence string 400 characters. Maximum 128 items per
section, 256 items total, 24 milestones per item, 512 milestones total, and a
1 MiB request. Section IDs and item IDs are unique across their respective
lists; milestone IDs are unique within the parent item.

Do not invent achievement dates from reconciliation time. Only completed
milestones may have a non-null `at`, no newer than `updatedAt`. Today/Yesterday
still use the existing dated `recent` entries, so keep those entries when
reconciling. Missing dates remain unknown. Local evidence locators, seals,
`evidenceRefs`, and source checklist paths stay local and are stripped by the
publisher and hub. Do not put them inside approved display text.

For checkbox percentages and daily changes, add optional `progress` to each
section and each checklist item:

```json
{
  "completed": 6,
  "total": 10,
  "basis": "C0-checklist-v1",
  "history": [
    {"completed": 4, "total": 10, "basis": "C0-checklist-v1", "at": "2026-10-11T00:00:00-06:00"},
    {"completed": 5, "total": 10, "basis": "C0-checklist-v1", "at": "2026-10-12T00:00:00-06:00"}
  ]
}
```

Illustrative only: 6/10 checked = 60%, up 10 percentage points today and 10
yesterday on October 12 in Denver. `completed` counts checked checklist entries;
`total` counts all entries. No scores, weights, partial-work credit, stage credit,
activity inference or milestone scoring. A C section counts its directly checked
subtasks. A subtask with its own actual checklist counts that checklist. A leaf
is checked or unchecked (1/1 or 0/1). Build/review/integration flags do not change
these counts. Milestone reports are not automatically checklist entries.

Whole-percent rounding never displays 100% until every entry is checked.
Counts are integers: total 1–100,000, completed 0–total. `basis` identifies the
stable checklist revision (required, 60 characters). Section progress must match
its supplied checked subtasks and known total; complete coverage allows exact
validation. An item at 100% must agree with its checked/completed status. Ledger
counts the authoritative checkboxes mechanically; it does not estimate progress.

Retain up to 32 dated count snapshots, including day-start baselines in the frame
timezone. History dates cannot exceed updatedAt. The latest snapshot at or before
local midnight supplies the reported baseline; the preceding day's baseline
supplies yesterday's comparison. Changing total or basis suppresses the comparison
until matching history exists. Missing history shows a dash, never invented zero.
Daily changes are percentage points in reported checkbox completion, not percentage
growth or engineering effort. The publisher does not modify checkbox history.

See [the synthetic recovery fixture](../../hub/test/fixtures/progress-recovery-v2.json)
for the exact shape. It is for testing, not live project status. Ledger should
atomically extend `agent-Ledger/runtime/evergreen-status.json` after reconciling
its evidence; the existing five-minute publisher then transports it unchanged
except for field selection. The recovery proposal must not be copied into the
live file merely to populate the screen.

## Automatic publisher setup

In server **/admin → Connections → Security**, generate an Evergreen token.
Save it on the source machine in `~/.config/frame-progress/hub-token` with mode
0600. It only authorizes publishing this progress feed, independently of the
AI usage token. Rotating it requires updating the publisher's token file.

Install these files on the source machine:

```sh
install -d -m 700 ~/.config/frame-progress ~/.local/lib/frame-progress
install -m 755 tools/project-progress/publish.py ~/.local/lib/frame-progress/
install -Dm644 tools/project-progress/frame-evergreen-sync.service ~/.config/systemd/user/frame-evergreen-sync.service
install -Dm644 tools/project-progress/frame-evergreen-sync.timer ~/.config/systemd/user/frame-evergreen-sync.timer
```

Create `~/.config/frame-progress/publisher.json` using the real hub address:

```json
{
  "hub": "http://YOUR-HUB:8099",
  "tokenFile": "~/.config/frame-progress/hub-token",
  "exporter": ["/absolute/path/to/ledger-progress-exporter", "--json"]
}
```

The exporter is an argument list run without a shell, with a 30-second timeout.
Alternatively replace `exporter` with `report`, the absolute path of a maintained
JSON snapshot. Configure exactly one source. Do not commit the token file.

After the source adapter works:

```sh
python3 ~/.local/lib/frame-progress/publish.py --config ~/.config/frame-progress/publisher.json
systemctl --user daemon-reload
systemctl --user enable --now frame-evergreen-sync.timer
systemctl --user list-timers frame-evergreen-sync.timer
```

This user timer runs while the source user's service manager is running. A
machine that sleeps or powers off stops publishing; the frame marks the feed
stale. A source exporter running on an always-on server can use the same files.
No redirects are followed and proxy environment settings are ignored when
posting the credential. Failures are logged without report bodies or tokens.

## Test report (disposable preview only)

```json
{
  "schemaVersion": 1,
  "project": "evergreen",
  "source": "Preview fixture — not project status",
  "updatedAt": "2026-10-12T20:00:00Z",
  "objective": "Example objective for layout testing",
  "next": "Example next action",
  "work": [{"id":"example", "title":"Example component", "owner":"Example owner", "stages":{"built":true,"reviewed":true,"integrated":false,"live":null}}],
  "recent": [{"id":"example-review", "title":"Example review finished", "stage":"reviewed", "at":"2026-10-12T19:00:00Z"}],
  "blockers": [{"id":"example-blocker", "title":"Example review dependency", "owner":"Example owner", "next":"Review the pending change"}],
  "decisions": []
}
```

Never publish this fixture to the household hub as actual Evergreen progress.
