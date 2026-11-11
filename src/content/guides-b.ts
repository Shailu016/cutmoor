import type { Guide } from "./types";

/** Guides 6–10. Written in parallel with the app build. */
export const GUIDES_B: Guide[] = [
  {
    slug: "trim-video-online",
    title: "How to trim a video online without re-encoding the whole file",
    description:
      "A practical guide to cutting clips without quality loss: keyframes, stream copy, exact trim, and the mistakes that force a full re-encode.",
    excerpt:
      "A trim can either copy the original video stream or rebuild it frame by frame. Knowing which one you need saves time and protects quality.",
    category: "Editing",
    published: "2026-11-11",
    modified: "2026-11-11",
    readingMinutes: 6,
    sections: [
      {
        heading: "What a trim actually does",
        paragraphs: [
          "Every trimmed export is one of two operations. The tool can copy the compressed video stream and throw away the packets outside your range, or it can decode the frames, cut at the exact moment you chose, and encode a new stream. The first is fast and lossless. The second is slower and always changes the picture a little, even at high quality settings.",
          "That difference explains most surprises people hit: a clip that starts a second early, a file that looks softer after export, or a one-minute cut that takes longer than expected. None of it is random. It comes down to where the cut lands relative to keyframes.",
        ],
        callout:
          "Rule of thumb: copy when you need speed or an archive cut, re-encode when the exact frame matters.",
      },
      {
        heading: "Keyframes decide where a fast cut can land",
        paragraphs: [
          "Video compression does not store every frame in full. It stores keyframes, also called I-frames, and then a run of predicted frames that only describe what changed. A typical keyframe interval is one to ten seconds. Encoders such as x264 default to 250 frames, which is about 8.3 seconds at 30 fps.",
          "A stream copy can only start on a keyframe. Ask for 00:00:05.000 and the nearest keyframe might be at 4.2 seconds. The export will either start at 4.2 or pad the gap, depending on the tool. The picture is untouched, but the timing is not what you requested. If the first frame must be exact, a copy is the wrong tool.",
        ],
        bullets: [
          "Keyframe spacing is set by the encoder, not by the file extension.",
          "Long GOPs are efficient but make fast cuts coarser.",
          "Phone footage often uses short GOPs, so copy cuts land closer to the request.",
        ],
      },
      {
        heading: "Fast trim vs exact trim",
        paragraphs: [
          "Most editors hide this choice behind labels like fast, precise, or smart. The labels vary; the trade-off does not.",
        ],
        table: {
          headers: ["Method", "What happens", "Speed", "Quality", "Best for"],
          rows: [
            [
              "Stream copy",
              "Cuts at the nearest keyframe and copies compressed packets",
              "Seconds",
              "No loss",
              "Rough cuts, archives, long recordings",
            ],
            [
              "Exact re-encode",
              "Decodes and re-encodes from the requested frame",
              "Slower",
              "One generation of loss",
              "Frame-accurate clips, social posts",
            ],
            [
              "Smart cut",
              "Copies the middle, re-encodes the first and last GOP",
              "Moderate",
              "Minimal loss",
              "Editing workflows that need both",
            ],
          ],
          caption:
            "Stream copy is sometimes called trimming without re-encoding. Smart cuts are often the default in desktop editors.",
        },
      },
      {
        heading: "Step by step",
        paragraphs: [
          "A clean trim takes less than a minute once you know which mode you are using.",
        ],
        bullets: [
          "Load the file and set the in and out points. Write down the exact timecodes.",
          "Decide whether the first frame must be exact. If yes, choose exact trim. If no, choose stream copy.",
          "Keep the source resolution, frame rate, and rotation. A trim is not the place to resize.",
          "Export to MP4 with H.264 video and AAC audio unless the source uses another codec you need to preserve.",
          "Play the first and last two seconds. Check for a frozen frame, a black flash, or audio that starts late.",
          "Keep the original file until the export has been checked on a second device.",
        ],
      },
      {
        heading: "When quality is lost",
        paragraphs: [
          "A single re-encode at a sane setting is hard to see. H.264 at CRF 18 to 20 is visually near-lossless for most footage; CRF 23 is the common default and still good; CRF 28 starts to smooth skin, gradients, and fine grain. The damage comes from stacking generations: trim, then compress, then add captions, then resize, with a fresh encode each time.",
          "Other avoidable losses: exporting at a higher resolution than the source, forcing a frame rate change, and using a bitrate below what the content needs. A static interview survives 3 Mbps at 1080p. Fast motion, confetti, and water need far more.",
          "In a command-line tool, a stream copy looks like this: ffmpeg -ss 00:01:23.500 -i input.mp4 -t 12 -c copy output.mp4. Remove -c copy and the same command re-encodes, which makes the start frame accurate. In browser tools such as ClipKit, the export dialog usually exposes the same choice as a speed or quality setting.",
        ],
      },
      {
        heading: "Common mistakes",
        paragraphs: [
          "Most bad trims are caused by a small set of habits. Fix these and the rest becomes predictable.",
        ],
        bullets: [
          "Assuming a fast cut is frame-accurate because the timeline shows the exact time.",
          "Re-encoding a file that only needed a copy, then compressing it again.",
          "Cutting inside the first or last keyframe interval and losing a second of usable footage.",
          "Trimming a variable frame rate phone clip and blaming the editor for audio drift.",
          "Exporting over the only copy of the original.",
          "Ignoring rotation metadata, which can leave a vertical clip sideways after a copy.",
        ],
      },
    ],
    faqs: [
      {
        question: "Does trimming a video reduce quality?",
        answer:
          "Only when the tool re-encodes. A stream copy keeps the original frames bit for bit. An exact trim re-encodes and loses a small amount, which is usually invisible at CRF 18 to 20 but adds up over repeated exports.",
      },
      {
        question: "Why does my trimmed clip start earlier than the time I set?",
        answer:
          "The cut snapped to the previous keyframe. Use exact trim, or set the in point a keyframe or two later if the tool only supports copy.",
      },
      {
        question: "Can I trim without re-encoding in a browser?",
        answer:
          "Sometimes. Browsers can copy some MP4 streams, but support depends on the codec and container. If the option is not offered, the tool is re-encoding.",
      },
      {
        question: "What is the best format for a trimmed clip?",
        answer:
          "MP4 with H.264 video and AAC audio is the safest choice. It plays nearly everywhere and is accepted by every major platform.",
      },
      {
        question: "Should I trim before or after compressing?",
        answer:
          "Trim first. Compressing footage you are about to delete wastes time and, if you export twice, adds an extra generation of loss.",
      },
    ],
  },
  {
    slug: "extract-audio-from-video",
    title: "How to extract audio from a video (MP3, WAV, M4A)",
    description:
      "MP3, WAV, or M4A? Choose the right audio format and bitrate for podcasts, voiceovers, and archives, and know the limits of using someone else's video.",
    excerpt:
      "The format you pick controls file size, compatibility, and whether the audio is copied or re-encoded. Here is how to choose without guessing.",
    category: "Audio",
    published: "2026-11-11",
    modified: "2026-11-11",
    readingMinutes: 6,
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
          "A voiceover for video should match the video's sample rate, usually 48 kHz. Export WAV to the editor, then let the video export handle the final AAC encode. ClipKit extracts audio locally in the browser, so the file never leaves your machine; pick M4A for a copy-friendly result or MP3 for a universal one.",
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
  },
  {
    slug: "convert-srt-to-vtt",
    title: "SRT vs VTT: how to convert subtitle files correctly",
    description:
      "SRT and WebVTT look similar but differ in headers, timestamps, and cue settings. Convert them without broken subtitles.",
    excerpt:
      "A comma instead of a period can break an entire caption file. Here is what changes between SRT and VTT, and how to convert cleanly.",
    category: "Subtitles",
    published: "2026-11-11",
    modified: "2026-11-11",
    readingMinutes: 5,
    sections: [
      {
        heading: "The short version",
        paragraphs: [
          "SRT is the oldest subtitle format still in daily use. It is plain text: a cue number, a start and end time, the caption, then a blank line. WebVTT is the web standard. It keeps the same basic shape, adds a required header, and supports positioning, styling, and regions.",
          "If the captions are going into an HTML5 video element, use VTT. If they are going to YouTube, a desktop editor, or a legacy player, SRT is usually accepted. Many tools read both, but they do not read them the same way.",
        ],
      },
      {
        heading: "Format differences that break converters",
        paragraphs: [
          "Most failed conversions come from four details: the header, the decimal separator, cue settings, and encoding.",
        ],
        table: {
          headers: ["Element", "SRT", "VTT"],
          rows: [
            ["File header", "None", "WEBVTT on the first line"],
            [
              "Timestamp",
              "00:00:01,000 --> 00:00:04,000",
              "00:00:01.000 --> 00:00:04.000",
            ],
            ["Cue number", "Required in practice", "Optional"],
            ["Position", "Not supported", "line:90% position:50% align:middle"],
            ["Comments", "Not standard", "NOTE blocks"],
          ],
          caption:
            "Commas become periods. That single change is the most common cause of a file that looks fine but will not load.",
        },
      },
      {
        heading: "Timestamps and cue settings",
        paragraphs: [
          "SRT timestamps always use HH:MM:SS,mmm. VTT uses HH:MM:SS.mmm and also accepts MM:SS.mmm when the hour is zero. Both allow an optional cue identifier on the line before the timestamp, but in SRT that line is effectively the cue number.",
          "VTT cue settings sit after the timestamp and before the caption text. Common examples:",
        ],
        bullets: [
          "line:90% places the cue near the bottom.",
          "position:50% align:middle centers it horizontally.",
          "size:80% limits the cue width.",
          "vertical:rl writes vertical text for some languages.",
        ],
        callout:
          "SRT has no standardized placement. Some older files use override tags such as {\\an8} to push a cue to the top, but support varies by player. Treat those tags as hints, not guaranteed layout.",
      },
      {
        heading: "Encoding and line endings",
        paragraphs: [
          "Save both formats as UTF-8. VTT requires UTF-8, and SRT players increasingly expect it. A file saved as Windows-1252 will turn curly quotes, dashes, and accented characters into symbols on another machine.",
          "Avoid a UTF-8 BOM unless you know the target player accepts it. Some web parsers treat the BOM as part of the WEBVTT signature and reject the file. Use LF or CRLF line endings; both are widely accepted, but keep the file consistent.",
          "If you receive a file with mojibake, open it using the original encoding, copy the text, and paste it into a fresh UTF-8 document. Do not run a blind search and replace on the damaged characters; that often makes the file harder to repair.",
          "Escape or replace characters that look like markup. In VTT, a literal ampersand should be written as &amp; and angle brackets as &lt; and &gt;. In SRT, most players tolerate raw text, but clean markup prevents surprises.",
        ],
      },
      {
        heading: "Manual conversion, step by step",
        paragraphs: [
          "A correct conversion is more than search and replace. Work through this order:",
        ],
        bullets: [
          "Open the SRT in a plain-text editor, not a word processor.",
          "Add WEBVTT as the first line, followed by a blank line.",
          "Replace the comma in every timestamp with a period. Do not touch commas in the caption text.",
          "Keep or remove cue numbers; VTT does not require them.",
          "Convert any positioning you need into VTT cue settings. SRT had nowhere to store it, so this is new work.",
          "Save as UTF-8, then open the file in a browser or validator and check sync at the start, middle, and end.",
        ],
      },
      {
        heading: "Checklist before you publish",
        paragraphs: [
          "A file can load and still be a bad viewing experience. Run this list before delivery.",
        ],
        bullets: [
          "Every cue has a start before its end.",
          "No cue is shorter than one second or longer than seven.",
          "Lines stay under about 42 characters, with two lines maximum.",
          "Reading speed stays around 15-20 characters per second.",
          "No overlapping cues unless the player supports them.",
          "The file name ends in .vtt and the MIME type is text/vtt when served.",
        ],
        callout:
          "Cue settings are not cosmetic. Captions at the default bottom position can sit under player controls or a social app's interface.",
      },
    ],
    faqs: [
      {
        question: "Can I rename an SRT file to VTT?",
        answer:
          "No. The header and timestamp separators are different, so most players will reject it. Convert the content, then change the extension.",
      },
      {
        question: "Does VTT support styling?",
        answer:
          "Yes, through cue settings, the ::cue pseudo-element in CSS, and STYLE blocks. Support varies by browser, so treat styling as an enhancement rather than a guarantee.",
      },
      {
        question: "Which format should I use for YouTube?",
        answer:
          "YouTube accepts SRT and VTT. SRT is the simplest upload; VTT is better if you need positioning for a web player.",
      },
      {
        question: "Why do accented characters show as symbols?",
        answer:
          "The file was saved in a legacy encoding such as Windows-1252. Re-save it as UTF-8 and check the text again.",
      },
      {
        question: "Do I need cue numbers in VTT?",
        answer:
          "No. They are optional identifiers. Keeping them can help when you debug a specific cue.",
      },
    ],
  },
  {
    slug: "best-video-size-for-reels-shorts-tiktok",
    title: "The best video size for Reels, Shorts, and TikTok in 2026",
    description:
      "A 2026 reference for vertical video: resolutions, aspect ratios, duration limits, bitrates, and safe zones for Reels, Shorts, and TikTok.",
    excerpt:
      "One 1080x1920 master covers all three platforms. Here are the numbers behind that claim, plus the safe zones that keep captions visible.",
    category: "Social media",
    published: "2026-11-11",
    modified: "2026-11-11",
    readingMinutes: 6,
    sections: [
      {
        heading: "Why 1080x1920 is the baseline",
        paragraphs: [
          "All three short-form platforms are built around a vertical 9:16 frame. At 1080x1920 that is 2.07 million pixels, a standard phone resolution, and a file size that uploads comfortably on mobile data. It is also the resolution most phones can shoot and edit without overheating.",
          "Shooting or exporting at 2160x3840 quadruples the pixel count. The platform will re-encode the upload anyway, often to 1080p or lower, so the extra detail rarely survives. A clean 1080x1920 file at a healthy bitrate beats a noisy 4K file at the same bitrate.",
          "If your source is horizontal, do not stretch it. Crop to 9:16 and reframe, or place it on a designed background. Stretched faces are the fastest way to look amateur.",
        ],
      },
      {
        heading: "Platform numbers for 2026",
        paragraphs: [
          "The duration column matters more than the resolution column. A three-minute Reel and a three-minute Short are different products from a 60-minute TikTok web upload, even though all three can be 1080x1920.",
        ],
        table: {
          headers: ["Platform", "Aspect", "Resolution", "Duration", "Working file size"],
          rows: [
            [
              "Instagram Reels",
              "9:16",
              "1080x1920",
              "Up to 3 minutes",
              "8-12 Mbps, about 60-90 MB per minute",
            ],
            [
              "TikTok",
              "9:16",
              "1080x1920",
              "Up to 10 minutes in app, 60 minutes on web",
              "8-12 Mbps, keep under 500 MB",
            ],
            [
              "YouTube Shorts",
              "9:16",
              "1080x1920",
              "Up to 3 minutes",
              "10-12 Mbps, under 2 GB",
            ],
            [
              "Facebook Reels",
              "9:16",
              "1080x1920",
              "Up to 90 seconds",
              "8-10 Mbps, under 1 GB",
            ],
          ],
          caption:
            "Limits change. Check the current upload help page before a campaign. The working sizes are practical targets, not platform guarantees.",
        },
      },
      {
        heading: "Bitrate and file size math",
        paragraphs: [
          "File size is bitrate multiplied by duration, divided by eight. At 10 Mbps, one second is 1.25 MB, so one minute is 75 MB and three minutes is 225 MB. That fits comfortably within mobile upload limits and still looks sharp after the platform's re-encode.",
          "Use H.264 High profile for compatibility, AAC audio at 128-192 kbps, and a 48 kHz sample rate. Keep the frame rate at 30 fps for talking heads and 60 fps for gameplay or fast motion. Do not mix frame rates in one timeline; convert before export.",
          "A lower bitrate is not automatically safer. Platforms compress again, and a starved upload develops blocky gradients and smeared motion that no server-side encode can fix.",
        ],
      },
      {
        heading: "Safe zones and captions",
        paragraphs: [
          "Every platform overlays buttons and text on the video. The exact layout changes, but the pattern is stable: a strip at the top for the header, a larger block at the bottom for the caption, username, and actions, and a column on the right for like, comment, and share.",
          "A practical safe zone for 1080x1920 is the central 1080x1420 area, keeping critical text at least 150-220 px from the top and 380-450 px from the bottom. Keep faces and logos out of the right 120 px if the interface overlaps them.",
        ],
        bullets: [
          "Put the hook in the upper-middle, not at the very top.",
          "Keep burned-in captions above the bottom 420 px.",
          "Leave the lower-right corner clear of logos and calls to action.",
          "Preview the export inside the app, not just in your editor.",
        ],
      },
      {
        heading: "Export settings that survive re-compression",
        paragraphs: [
          "Export from the highest-quality source you have. Do not export from a file that has already been through three apps. Each trip through a lossy encoder adds artifacts, and vertical video magnifies them because the frame is scaled up on a phone screen.",
        ],
        bullets: [
          "Container: MP4.",
          "Video: H.264, 1080x1920, 30 or 60 fps, 8-12 Mbps.",
          "Audio: AAC, 128-192 kbps, 48 kHz, stereo.",
          "Color: Rec. 709, full range off, standard gamma.",
          "Fast start enabled so playback begins before the full file downloads.",
          "Captions: burned in for social, or a separate VTT for a web player.",
        ],
      },
      {
        heading: "Common mistakes",
        paragraphs: [
          "These are the settings and habits that most often make a vertical video look worse than it needs to.",
        ],
        bullets: [
          "Uploading 4K because higher is better. It is not, once the platform re-encodes.",
          "Letterboxing horizontal footage with huge black bars.",
          "Putting captions in the bottom 300 px where the interface covers them.",
          "Using a 24 fps cinematic export for fast motion, then wondering why it stutters.",
          "Stretching a 16:9 clip instead of cropping or reframing.",
          "Exporting at 3 Mbps to save space and losing the gradient sky.",
        ],
      },
    ],
    faqs: [
      {
        question: "Is 4K better for Reels or TikTok?",
        answer:
          "Usually no. The platforms re-encode uploads, and most viewers watch on a 1080p phone screen. A clean 1080x1920 file at 8-12 Mbps is the better trade.",
      },
      {
        question: "Can I use the same file for all three platforms?",
        answer:
          "Yes, if it fits the shortest duration limit and keeps text inside the strictest safe zone. Facebook Reels at 90 seconds is often the binding constraint.",
      },
      {
        question: "What frame rate should I use?",
        answer:
          "30 fps for talking heads and static shots, 60 fps for gameplay, sports, or fast camera moves. Keep it consistent for the whole clip.",
      },
      {
        question: "Why does my video look soft after upload?",
        answer:
          "The platform re-encoded it, and the source bitrate was probably low. Export at 8-12 Mbps and avoid upscaling from 720p.",
      },
      {
        question: "Should captions be burned in or uploaded separately?",
        answer:
          "Burn them in for Reels, Shorts, and TikTok because viewer-side caption support varies. Use a separate VTT when the video plays in your own web player.",
      },
    ],
  },
  {
    slug: "reduce-video-file-size-without-losing-quality",
    title: "How to reduce video file size without losing quality",
    description:
      "A practical guide to bitrate, resolution, codecs, CRF, and audio settings, with a decision table for common sharing and publishing tasks.",
    excerpt:
      "Smaller files do not require ugly video. Change the right setting, in the right order, and most of the size comes off without a visible cost.",
    category: "Compression",
    published: "2026-11-11",
    modified: "2026-11-11",
    readingMinutes: 7,
    sections: [
      {
        heading: "Start with the bitrate",
        paragraphs: [
          "Bitrate is the number of bits used per second of video. It is the biggest lever on file size: double the bitrate and you roughly double the file, before accounting for audio and container overhead. The math is simple. Size in bytes equals bitrate in bits per second multiplied by duration in seconds, divided by eight.",
          "A 10-minute clip at 8 Mbps is 8,000,000 x 600 / 8 = 600,000,000 bytes, or about 600 MB. Audio adds a little: 128 kbps for 10 minutes is about 9.6 MB.",
          "Compressing a video is really a question about how many bits per second the content needs. A talking head needs far fewer than a confetti-filled dance clip.",
        ],
      },
      {
        heading: "The five levers, in order of impact",
        paragraphs: [
          "Resolution is the most misunderstood lever. Going from 1080p to 720p leaves about 44 percent of the pixels, but it does not automatically remove 56 percent of the file size if the encoder keeps the same quality target. With CRF, the encoder spends fewer bits because there is less detail to preserve, so the saving is real but content-dependent.",
          "Codec choice matters just as much. H.265 (HEVC) typically reaches the same visual quality as H.264 at a lower bitrate, and AV1 can go further, but both cost encode time and may not play on older devices. H.264 remains the compatibility default.",
        ],
        table: {
          headers: ["Lever", "What it saves", "What it costs", "When to use it"],
          rows: [
            ["Bitrate or CRF", "Large, often 30-60%", "Fine detail, grain, motion", "Every export"],
            ["Resolution", "Large when stepping down", "Sharpness on large screens", "Phone-first or email delivery"],
            ["Codec", "25-50% versus H.264", "Compatibility and encode time", "Modern devices, archive copies"],
            ["Frame rate", "Up to 50% at 30 vs 60", "Motion smoothness", "Static or slow content"],
            ["Audio bitrate", "Small", "Music clarity at very low rates", "Voice-first files"],
          ],
          caption:
            "Percentages are typical ranges, not guarantees. Test on a short clip first.",
        },
      },
      {
        heading: "CRF and two-pass, without the mystique",
        paragraphs: [
          "CRF, or constant rate factor, tells the encoder to target a quality level and vary the bitrate as needed. Lower values mean higher quality and bigger files. For H.264, 18-20 is visually near-lossless for most content, 23 is the common default, and 28 is visibly softer. For HEVC, shift the range upward by about 4-6 points; for AV1, by about 8-10.",
          "Two-pass encoding is different. You give the encoder a target bitrate or file size, and it analyzes the clip twice to distribute bits intelligently. Use it when an upload portal enforces a hard limit, such as 16 MB for a messaging app. Use CRF when you care about quality and do not need an exact size.",
          "Do not combine the two. A CRF value plus a target bitrate produces confusing results. Pick one strategy: quality target for general use, bitrate target for a size ceiling.",
        ],
      },
      {
        heading: "A decision table by use case",
        paragraphs: [
          "Match the export to the destination. A messaging file and an archive master should not use the same settings.",
          "For a 60-second clip that must fit in 16 MB, the total budget is about 2.1 Mbps including audio. Set video to roughly 1.9 Mbps, audio to 96 kbps, and use two-pass. At that budget, 720p looks better than 1080p because every pixel gets more bits.",
        ],
        table: {
          headers: ["Use case", "Resolution", "Codec", "Quality setting", "Audio"],
          rows: [
            ["Email attachment", "720p", "H.264", "CRF 26-28", "96 kbps mono"],
            ["Messaging app (16 MB)", "720p", "H.264", "Two-pass, size target", "64-96 kbps mono"],
            ["Web background loop", "1080p", "H.264 or AV1", "CRF 26-30", "Muted or 96 kbps"],
            ["YouTube upload", "1080p or 4K source", "H.264", "CRF 18-20", "192-256 kbps stereo"],
            ["Phone storage", "1080p", "HEVC", "CRF 24-26", "128 kbps stereo"],
            ["Archive master", "Source", "H.264 or FFV1", "CRF 18 or lossless", "PCM"],
          ],
          caption:
            "Use two-pass only when a hard size limit matters. Otherwise CRF gives better quality per bit.",
        },
      },
      {
        heading: "What not to do",
        paragraphs: [
          "Watch the export on a phone, in daylight, at normal volume. Artifacts that are invisible on a calibrated monitor often show up on a small screen with contrast turned up.",
        ],
        bullets: [
          "Do not upscale before compressing. Upscaling adds pixels and bytes without adding detail.",
          "Do not re-encode the same file repeatedly. Cut, caption, and compress in one pass where possible.",
          "Do not drop below 24 fps for motion. It will look like a slideshow, not a style choice.",
          "Do not use 64 kbps for music. Cymbals and strings turn to mush.",
          "Do not trust a preset name. HD and web mean different things in different apps.",
          "Do not delete the original until the compressed copy has been checked on the target device.",
        ],
      },
    ],
    faqs: [
      {
        question: "Does reducing resolution always reduce file size?",
        answer:
          "No. If you force a high bitrate, a 720p file can be larger than a 1080p file encoded at a lower quality target. With CRF, lowering resolution usually reduces size because there is less detail to encode.",
      },
      {
        question: "Is HEVC worth using?",
        answer:
          "Yes for storage and modern devices: it can cut size substantially at similar quality. No if the file must play on older Android devices, older browsers, or some editors without transcoding.",
      },
      {
        question: "What CRF is visually lossless?",
        answer:
          "For H.264, CRF 18 is a common working definition, though it is still lossy. CRF 0 is mathematically lossless and produces very large files. For delivery, 18-23 is the practical range.",
      },
      {
        question: "Can I compress a video with no quality loss?",
        answer:
          "Only with a lossless codec, which usually makes the file larger. For normal delivery, aim for visually lossless: a file that looks the same at normal viewing size.",
      },
      {
        question: "Why did my compressed file get bigger?",
        answer:
          "Common causes: upscaling, a higher bitrate preset than the source, a less efficient codec, or adding a high-bitrate audio track. Check the output settings against the source.",
      },
    ],
  },
];
