import type { GuideBody } from "../../types";

export const body: GuideBody = {
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
};
