# Voice work list

- [ ] **Make the Homie wake word.** Reuse openWakeWord's pretrained speech
  features and training tools; train a small classifier for exactly “Homie”.
  Evaluate real voices, room noise, music and similar words before replacing
  the temporary model.
- [x] Install and enable the temporary **Hey Orbis** detector on the Echo.
  Detection stays on the display; only a detected question goes through the
  existing local voice worker. On-device file tests recognized two positive
  clips and rejected four negative clips, averaging 53–56 ms per 80 ms frame.
  The user confirmed real-voice wake and reply work on the Echo.
- [x] Add a wake acknowledgment sound, reactive blue listening waves, and
  automatic submission after three seconds of quiet. Keep controls for cancel
  and early submission, and a preview that never records.
- [x] Replace listening waves with warm pulsing dots while preparing a reply,
  with an explicit microphone-off label.
- [x] Calibrate the silence endpoint against standby room noise and reject isolated
  clicks, so steady fans don't keep resetting the quiet countdown.
- [ ] Connect spoken requests to a coding assistant with the live display
  tools. The current local Bonsai conversation is separate from the active
  coding-assistant chat; that routing is not connected yet.

Temporary model: [protoLabsAI/hey-orbis-wakeword](https://huggingface.co/protoLabsAI/hey-orbis-wakeword),
revision `a5c9064affdfb487114c7dda083e38e4390e153d`.
It recognizes “Hey Orbis”; changing its filename does not change its wake phrase.
