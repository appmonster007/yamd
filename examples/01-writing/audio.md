---
title: Audio notes
---

# Audio notes

**YAMD: Record Audio and Add Link** (also in the editor's right-click menu) records from your microphone, saves the recording as a file next to the note, and puts a link to it where your cursor was.

1. Put the cursor where the link should go and run the command. A recorder opens beside the note.
2. Press **Record**, **Pause** or **Stop** as needed; the bar shows the input level.
3. Play it back, optionally give it a name, and press **Save and add link**.

The file goes into the `audio` folder next to the note (change it with the `yamd.audio.folder` setting) as `note-YYYY-MM-DD-HHMM.webm`, and a link is written on its own line with a blank line either side. If your cursor was inside a code block, the link goes after the block. The position is tracked while you record, so editing above it doesn't move the link.

An example of what it leaves behind:

[Recording 5 Nov, 09:30](audio/note-2026-11-05-0930.wav)

If VS Code won't give its recorder panel the microphone, the panel offers **Record in browser instead**: the same recorder opens in your browser (a local page that only your machine can reach) and the file still lands next to the note.

Notes: the file is saved as recorded (WebM with Opus audio), which plays in VS Code and Chromium-based browsers; a link works in GitHub and in an exported page, which an embedded player would not. The workspace must be trusted, and a new note must be saved first.

## Try it

1. Save the note, put the cursor on a blank line, and run **YAMD: Record Audio and Add Link**.
2. Allow the microphone, press **Record**, speak, press **Stop**.
3. Press **Save and add link**. A file lands in `audio/` and a link appears at the cursor.
4. For text, see [transcribing a recording](../07-whats-new/audio-transcript.md).
