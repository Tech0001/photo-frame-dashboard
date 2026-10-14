# Local Echo voice for Hub

The Voice button offers tap-to-talk and typed questions. The kiosk records up to
30 seconds after a tap or an explicitly enabled wake-word detection, stops on
demand or when leaving the app, and discards the recording after processing.
Capture uses bounded, mono PCM WAV in memory,
with a fresh AudioRecord session for each question. This avoids AAC recorder
timestamp failures on the Echo’s Android build. Hub forwards it to an
authenticated local worker.

## Optional hands-free listening

The kiosk's two-finger controls include **Enable Hey Orbis wake word** and
**Pause Hey Orbis wake word**. It is off by default and saved per device. An
enabled listener displays a small badge, which can also be tapped to pause.
It resumes after a normal app launch, provided the dashboard is ready and
microphone permission remains granted. The dashboard URL must select a display
profile using `?display=...`.

Say **Hey Orbis**, then your question. Detection uses openWakeWord's shared
features and protoLabsAI's classifier on the display CPU. Only the subsequent
question, with a short pre-roll to avoid clipping its first word, goes to Hub.
Standby audio stays in bounded memory on the display and is never uploaded or
saved. A question sends after about 1.6 seconds of quiet, or at the 30-second
limit. No question times out after six seconds. **Send now** and **Close** remain
available. Spoken replies temporarily use an app-private WAV, deleted after
playback/cancel; conversation history is a short in-memory list.

Listening stops when leaving the kiosk, and wake recognition pauses during
audio playback to avoid recognizing the assistant's own reply. This initial
version does not support interrupting speech or waking over music. It resumes
after playback. A native voice panel keeps this working with an existing Hub
deployment without requiring a server/frontend update.

Build assets are pinned and checksum-verified by
`dashboard/kiosk/prepare-wakeword.py`; downloads are ignored by Git. Attribution
and licenses are bundled in the APK. See
[the voice work list](../../docs/voice-roadmap.md) for the planned **Homie** model
and coding-assistant connection. “Hey Orbis” is the temporary wake phrase;
the assistant is still Homie, and this feature does not connect to the active
Codex conversation.

The worker supports either an installed Nemotron speech runtime/model or a local
faster-whisper model. Piper supplies the spoken voice. General conversation uses
a loopback OpenAI-compatible language-model server such as LM Studio; it is a
separate local assistant, not the user's existing Codex conversation. Short
conversation history is kept in the open panel, not a maintained task list.

Local commands can open allowed dashboard pages or read weather, groceries and
chores. There are no shell commands or device-control tools. Recorded speech and
selected household context stay on your LAN/PC. No cloud API credentials are
required. Hub's API token is scoped to the display and rate-limited. Keep Hub
private on the household network.

## Worker configuration

Install Python 3.12 packages in a dedicated environment (do not modify another
app's environment): `faster-whisper`, `piper-tts`, and `av`. Store config and token
outside Git, with directory mode 0700 and file mode 0600. Configure `worker.py`:

```json
{
  "port": 8101,
  "tokenFile": "/private/path/worker-token",
  "speechEngine": "nemotron",
  "speechBinary": "/path/to/nemo-speech",
  "speechModel": "/path/to/nemotron-3.5-asr-streaming-0.6b.q8_0.gguf",
  "device": "vulkan:0",
  "speechFallbackDevice": "cpu",
  "language": "en",
  "voiceModel": "/path/to/piper-voice.onnx",
  "chatUrl": "http://127.0.0.1:1234/v1/chat/completions",
  "chatModel": "your-loaded-model"
}
```

The Nemotron runtime's companion libraries must be beside its executable. The
worker sets its library path and converts microphone input to 16 kHz mono WAV.
Nemotron inference runs in a separate process with bounded time and input size.
Use the device supported by your existing runtime. Optional `speechFallbackDevice`
retries on CPU only when the GPU cannot allocate model memory; other failures
remain errors. The authenticated health response reports the last device used.
For Whisper, omit speechEngine/speechBinary and point speechModel at a complete
local faster-whisper directory; computeType defaults to int8. No model download
occurs during a voice request. Supply Piper's adjacent `.onnx.json` configuration.
Use voices in accordance with their individual model licenses.

Reuse an existing local model endpoint by supplying only `chatUrl` and
`chatModel`. This sends requests directly, allowing socket-activated servers to
start themselves without a separate model-list check.

Optional `serverCommand` and `loadCommand` are local, trusted argument arrays
run without a shell to start/load an installed local model. They are never set
by incoming questions or the dashboard. A large model may respond slowly; a
small local instruction model is more suitable for conversational latency.

Start the worker on the PC's loopback interface. If Hub runs elsewhere, reach it
through a persistent SSH reverse tunnel: the server's `127.0.0.1:8101` forwards to
the PC's `127.0.0.1:8101`. Use a dedicated key restricted to that loopback port and
no shell access. Do not expose the model server on all interfaces. Run both the
worker and tunnel as restarting user services.

In **Hub → Connections → Voice**, enable local voice, enter the tunnel URL and
its dedicated worker token, and choose whether to allow AI conversation. Enable
Voice in the desired display's profile. When the PC sleeps/disconnects, Voice
shows it unavailable while the household dashboard keeps running on Hub.

Build/install the kiosk and grant microphone permission when asked. Capture is
native so it works with a LAN HTTP dashboard without weakening WebView's browser
microphone restrictions. Only the kiosk's selected dashboard origin can request
recording or open the fixed Spotify app. Ordinary browsers support typed questions.

Dependencies run separately from Hub; their code/models are not bundled here:
[Nemotron speech](https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b),
[faster-whisper](https://github.com/SYSTRAN/faster-whisper),
[Piper](https://github.com/OHF-Voice/piper1-gpl), and
[LM Studio](https://lmstudio.ai/docs/developer).
