---
title: Transcribing a recording
---

# Transcribing a recording

**YAMD: Transcribe Audio** runs a speech-to-text tool you have installed on a recording linked in the note, and writes the text under the link as a callout. YAMD sends nothing anywhere; it only runs your command. Set it once, with `{file}` standing for the recording:

```
yamd.audio.transcribeCommand = whisper-cli -m ~/models/ggml-base.en.bin -nt -f {file}
```

Put the cursor on the link's line (or choose from a list) and run the command. Running it again replaces the transcript. What it leaves behind:

[Recording 5 Nov, 09:30](../01-writing/audio/note-2026-11-05-0930.wav)

> [!note] Transcript
> Welcome to the stand-up.
> Ada finished the sign-up flow.
> Alan is load testing the API.
