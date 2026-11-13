import type { GuideBody } from "../../types";

export const body: GuideBody = {
  sections: [
    {
      heading: "What MOV actually is",
      paragraphs: [
        "MOV is a container format Apple introduced with QuickTime in 1991. The name describes the box, not the video inside it. A MOV file can hold H.264, HEVC, ProRes, or uncompressed video, plus several audio tracks, timecode, chapter markers, and an alpha channel. That flexibility is why iPhones and Macs default to it.",
        "An iPhone recording is usually HEVC or H.264 in a MOV container. A camera rig may write ProRes, which is huge but easy to edit. Neither is visible from the extension, so two clip.mov files can behave differently.",
      ],
    },
    {
      heading: "When MP4 is the better choice",
      paragraphs: [
        "MP4 is also a container, but it is the one the rest of the world expects. Windows, Android, smart TVs, browsers, and social platforms all handle MP4 with H.264 and AAC without extra codecs.",
      ],
      bullets: [
        "Playback: no codec pack, no unsupported-format message.",
        "Web: faststart lets the video begin before the whole file downloads.",
        "Sharing: messaging apps and social platforms accept MP4 everywhere.",
        "Size: H.264 MP4 is a fraction of a ProRes MOV for the same footage.",
        "Handoff: MP4 is safer when the other person is on a different platform.",
      ],
      table: {
        headers: ["Property", "MOV", "MP4"],
        rows: [
          ["Origin", "Apple QuickTime", "ISO media standard"],
          ["Common codecs", "ProRes, HEVC, H.264", "H.264, HEVC, AV1"],
          ["Platform support", "Best on Apple devices", "Broad on phones, TVs, browsers"],
          ["Alpha channel", "Supported with some codecs", "Not with H.264"],
          ["Streaming", "Possible", "Faststart is standard"],
        ],
      },
    },
    {
      heading: "H.264 vs HEVC",
      paragraphs: [
        "H.264 is the safe default. It plays on almost everything made in the last 15 years, encodes quickly, and has universal hardware support. HEVC, also called H.265, delivers similar quality at a lower bitrate, often 25 to 50 percent lower, but support is patchier. Older Windows machines may need a codec pack, some Android devices lack hardware decoding, and browser support varies.",
        "Use H.264 for files you share. Keep HEVC for your own archive only when you know the playback device handles it. Do not pick it just because the number is smaller.",
      ],
      table: {
        headers: ["Codec", "Compatibility", "Efficiency", "Use it for"],
        rows: [
          ["H.264", "Excellent", "Good", "Sharing, web, editing handoffs"],
          ["HEVC", "Mixed on older devices", "25 to 50 percent smaller", "Personal archives, newer Apple gear"],
          ["ProRes", "Apple and pro editors", "Very large files", "Editing, not delivery"],
        ],
      },
    },
    {
      heading: "Settings that keep the quality",
      paragraphs: [
        "Conversion means a stream copy, which keeps the codec and is lossless, or a decode and re-encode. A stream copy only works when the target supports the codec, so most MOV to MP4 jobs need a real encode.",
      ],
      bullets: [
        "CRF 18 to 23 for H.264. Lower is better. 18 is close to visually lossless for most footage, and 23 is a sensible delivery default.",
        "Preset medium or slow. Slower presets buy efficiency, not quality, and they take longer.",
        "Profile High, level 4.1 for 1080p and 5.1 for 4K.",
        "Keep the source resolution and frame rate. Do not upscale.",
        "Audio AAC at 192 kbps, 48 kHz. Decide whether a surround source should be downmixed to stereo.",
        "Enable faststart when the file will be streamed.",
        "Tone map HDR to SDR, or colors will look washed out on non-HDR displays.",
      ],
      callout:
        "Renaming .mov to .mp4 does not convert anything. The container and codec stay the same, and players that failed before will keep failing.",
    },
    {
      heading: "Step by step",
      paragraphs: [
        "Check the source before choosing settings. A ProRes master and an iPhone clip need different treatment even though both are MOV files.",
      ],
      bullets: [
        "1. Inspect the file. Note the codec, resolution, frame rate, audio channels, and whether it is HDR.",
        "2. Choose MP4 with H.264 unless you have a specific reason to keep HEVC.",
        "3. Set CRF 20 and preset medium for a good balance of size and quality.",
        "4. Match the audio to the source. Do not turn mono into stereo for no reason.",
        "5. Export, then play the result in a different player than the one you used to convert.",
        "6. Check duration, audio sync, and rotation before you delete the original.",
        "7. Keep the MOV until the MP4 is verified. Cutmoor converts in the browser, so the file stays on your machine.",
      ],
    },
    {
      heading: "Conversion pitfalls",
      paragraphs: [
        "Most failed conversions are mismatched expectations about what a container can hold.",
      ],
      bullets: [
        "Expecting a ProRes file to shrink with no visible change. H.264 at CRF 20 is far smaller, but not identical.",
        "Losing alpha. H.264 in MP4 does not carry transparency. Use ProRes 4444 or a WebM codec that supports alpha.",
        "Washed-out HDR. Naive tone mapping clips highlights or shifts skin tones. Check a frame before exporting.",
        "Variable frame rate. Phone recordings often use VFR. Some encoders assume constant and let audio drift. Force a constant rate when the tool allows it.",
        "Dropped rotation metadata. A portrait iPhone clip may be stored landscape with a flag. Some converters ignore it, and the video arrives sideways.",
        "Multiple audio tracks. MP4 can hold several, but many players pick the first. Choose the right one during export.",
      ],
    },
  ],
  faqs: [
    {
      question: "Is MOV higher quality than MP4?",
      answer:
        "No. The container does not set quality. Codec, bitrate, and resolution do. A ProRes MOV can be excellent, and an H.264 MP4 can match it visually at a much smaller size.",
    },
    {
      question: "Will converting MOV to MP4 lose quality?",
      answer:
        "A re-encode is lossy, but at CRF 18 to 20 the difference is hard to see. If the MOV already contains H.264 or HEVC, a stream copy can change the container without re-encoding at all.",
    },
    {
      question: "Can I convert MOV to MP4 on an iPhone?",
      answer:
        "Yes, but Photos may hand you another MOV. A browser-based converter avoids installing an app and keeps the file local.",
    },
    {
      question: "Why is my MP4 larger than the MOV?",
      answer:
        "Different codecs or settings. ProRes is an editing format with a huge bitrate; H.264 is built for delivery. A bigger MP4 usually means a higher quality or less efficient preset.",
    },
    {
      question: "Does MP4 support 4K and HEVC?",
      answer:
        "Yes. MP4 can hold 4K H.264, 4K HEVC, and AV1. The container is not the limit; the player and device are.",
    },
  ],
};
