import type { GuideBody } from "../../types";

export const body: GuideBody = {
  sections: [
    {
      heading: "What extraction actually does",
      paragraphs: [
        "A video file is a container holding a video stream, one or more audio streams, and metadata. Extracting audio can mean two things: copying the existing audio stream into a new file, or decoding it and encoding a new format. Copying is instant and lossless. Encoding is slower and, for lossy formats, changes the sound.",
        "If the source is an MP4 with AAC audio, saving to M4A can be a pure copy. Saving to MP3 or WAV requires a decode, and MP3 adds a second lossy generation. WAV preserves exactly what was decoded, but it cannot restore detail that the original compression already removed.",
      ],
    },
    {
      heading: "Pick the right format",
      paragraphs: [
        "There is no single best format. The right one depends on where the file is going and whether it needs to be edited again.",
      ],
      table: {
        headers: ["Format", "Type", "Typical setting", "Size per minute", "Best for"],
        rows: [
          ["MP3", "Lossy", "128 kbps stereo", "About 1 MB", "Sharing, older players"],
          [
            "M4A (AAC)",
            "Lossy",
            "128-256 kbps",
            "1-2 MB",
            "Podcasts, Apple devices, MP4 workflows",
          ],
          [
            "WAV",
            "Uncompressed PCM",
            "16-bit, 44.1 kHz stereo",
            "About 10.6 MB",
            "Editing, mastering, archives",
          ],
          [
            "FLAC",
            "Lossless compressed",
            "16-bit, 44.1 kHz",
            "About 5-7 MB",
            "Archiving without PCM size",
          ],
        ],
        caption:
          "Sizes are decimal megabytes. 128 kbps is 0.96 MB per minute; 16-bit 44.1 kHz stereo PCM is about 10.6 MB per minute.",
      },
    },
    {
      heading: "Bitrate choices that actually matter",
      paragraphs: [
        "Bitrate is the amount of data per second. More bits can capture more detail, but returns fall off quickly, especially for speech. A useful starting range:",
      ],
      bullets: [
        "Voice, one speaker: 96-128 kbps mono.",
        "Interview or podcast, two people: 128-192 kbps stereo, or two mono tracks.",
        "Music: 192-256 kbps stereo for casual listening, 320 kbps for MP3 delivery.",
        "Archive: WAV or FLAC; do not use a high-bitrate MP3 as a master.",
      ],
    },
    {
      heading: "Mono vs stereo",
      paragraphs: [
        "Stereo doubles the data. For a single voice, mono is the correct default: it saves half the space, sums cleanly on phone speakers, and avoids the hollow phase problems that come from duplicating one channel.",
        "Keep stereo for music, field recordings, and anything with real left-right information. Watch for stereo files where one channel is silent or duplicated. Converting those to mono is a free size win with no audible loss.",
        "If you need both channels but half the size, try 96 kbps per channel rather than folding to mono. The result is still stereo, just leaner. AAC usually sounds better than MP3 at the same bitrate, so 128 kbps AAC is a reasonable music setting while 128 kbps MP3 is more marginal.",
      ],
    },
    {
      heading: "Podcast and voiceover settings",
      paragraphs: [
        "For spoken-word delivery, export a clean master and a compressed release. Master: WAV, 48 kHz, 24-bit, mono or stereo as recorded. Release: MP3 or M4A, 44.1 or 48 kHz, mono for a solo show, 96-128 kbps.",
        "Normalize loudness rather than peaks. Podcast platforms commonly normalize around -16 LUFS for stereo and -19 LUFS for mono; Spotify targets about -14 LUFS. A high-pass filter at 80-100 Hz removes rumble, and light compression evens out levels before the final limiter.",
        "A voiceover for video should match the video's sample rate, usually 48 kHz. Export WAV to the editor, then let the video export handle the final AAC encode. Cutmoor extracts audio locally in the browser, so the file never leaves your machine; pick M4A for a copy-friendly result or MP3 for a universal one.",
      ],
    },
    {
      heading: "Legal limits",
      paragraphs: [
        "Extracting audio does not change who owns it. Use only recordings you made, content you licensed, or material the owner has explicitly permitted. A platform's terms of service do not grant you copyright, and fair use is a legal defense decided case by case, not a blanket permission.",
        "Music is the usual trap. Pulling a song from a video and using it in your own upload can trigger Content ID claims, muted audio, or takedowns. Keep receipts for any license, including the track name, license type, and date.",
        "If you are extracting your own audio for a client, confirm the client owns the recording or has permission from the performers. A one-line release is cheaper than a dispute.",
      ],
      callout:
        "When in doubt, do not publish. Ask the rights holder in writing and keep the reply.",
    },
  ],
  faqs: [
    {
      question: "Does extracting audio reduce quality?",
      answer:
        "If the tool copies the existing stream, no. If it converts to MP3 or another lossy format, yes, by a small amount. Converting to WAV avoids new loss but cannot undo the original compression.",
    },
    {
      question: "Can I get a WAV from any video?",
      answer:
        "Yes, but it will be a decoded copy of a lossy source. It is useful for editing, not for recovering quality that was never there.",
    },
    {
      question: "Why is the extracted audio out of sync?",
      answer:
        "The source may use a variable frame rate, a delayed start, or multiple audio streams. Extract from the original file and keep the offset, rather than lining up a re-encode by ear.",
    },
    {
      question: "What bitrate should I use for a voice memo?",
      answer:
        "96 kbps mono at 44.1 or 48 kHz. Speech stays clear and the file is small enough to email.",
    },
    {
      question: "Can I extract audio from a YouTube video?",
      answer:
        "Only if you own it or have permission. Downloading and extracting someone else's video generally violates the platform's terms and may infringe copyright.",
    },
  ],
};
