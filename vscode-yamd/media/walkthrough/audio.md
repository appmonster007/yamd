# Voice notes

**Record Audio and Add Link** records in a panel beside the note, saves the file in an `audio` folder next to it, and writes a link where your cursor was. If VS Code won't give the panel the microphone, the recorder opens in your browser instead.

**Transcribe Audio** runs a speech-to-text tool you have installed and writes the text under the link as a `Transcript` callout. Set the command once:

````
yamd.audio.transcribeCommand = whisper-cli -m ~/models/ggml-base.en.bin -nt -f {file}
````

YAMD sends nothing anywhere; it only runs your command.
