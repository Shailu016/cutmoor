import type { GuideBody } from "../../types";

export const body: GuideBody = {
  sections: [
    {
      heading: "What WhatsApp actually does to a video",
      paragraphs: [
        "WhatsApp treats video two different ways. If you attach a clip through the photo and video picker, the app re-encodes it before it leaves your phone. Resolution drops, the bitrate drops, and a 4K file can arrive looking like it came from a 2012 flip phone. The chat limit for that path is about 16 MB per file on current iOS and Android builds.",
        "If you attach the same file as a document, WhatsApp sends the bytes unchanged. The recipient gets a file card they have to tap and download, but the quality is exactly what you exported. The document limit is 2 GB, which is far more room than most people need.",
        "Status is its own format. A status clip is capped at 60 seconds and gets the same heavy re-encode as a chat video. Vertical is assumed, so a horizontal clip will be cropped or padded whether you plan for it or not.",
      ],
      table: {
        headers: ["Route", "Limit", "What happens"],
        rows: [
          ["Photo and video picker", "About 16 MB", "Re-encoded to a low bitrate, often 480p"],
          ["Document attachment", "Up to 2 GB", "Sent as-is, no compression"],
          ["Status", "60 seconds per clip", "Re-encoded and cropped to vertical"],
        ],
        caption:
          "Limits shift with app version and platform. These are the numbers most current iOS and Android builds enforce.",
      },
    },
    {
      heading: "Choose a size before you choose a setting",
      paragraphs: [
        "Compression gets easier once you convert the limit into a bitrate. File size in megabytes is roughly total bitrate in megabits per second, times duration in seconds, divided by eight. A 60-second clip at 2 Mbps total lands near 15 MB. Leave headroom for container overhead and aim for 12 to 14 MB when the ceiling is 16 MB.",
      ],
      bullets: [
        "15 seconds at 6 Mbps total: about 11 MB.",
        "30 seconds at 3 Mbps total: about 11 MB.",
        "60 seconds at 1.5 Mbps total: about 11 MB.",
        "120 seconds at 700 kbps total: about 10.5 MB.",
      ],
      callout:
        "Audio counts toward the budget. At 128 kbps, a minute of audio is under 1 MB, which is worth spending. Cutting audio to 32 kbps saves space but makes voices sound like a drive-through speaker.",
    },
    {
      heading: "Settings that hold up",
      paragraphs: [
        "You do not need a complicated preset. Five choices do most of the work, and the rest is detail.",
      ],
      bullets: [
        "Resolution: 1280x720 for chat, 1920x1080 for documents and status. Never upscale a smaller source.",
        "Codec: H.264 in an MP4 container. High profile at level 4.0 plays on older phones. H.265 saves space, but some Android devices still struggle with it.",
        "Frame rate: keep the source rate up to 30 fps. Turning 60 into 30 roughly halves the bitrate needed for the same sharpness.",
        "Rate control: CRF 23 to 26 for a single pass, or a two-pass target bitrate when you must hit a number.",
        "Audio: AAC at 96 to 128 kbps, 48 kHz stereo. MP4 with faststart starts playing before the download finishes.",
      ],
    },
    {
      heading: "Step by step",
      paragraphs: [
        "Work in this order and you avoid the usual cycle of exporting, checking, and exporting again.",
      ],
      bullets: [
        "1. Trim first. Cut dead air and shaky intros before encoding. Every second you remove is bitrate you can spend on the seconds that remain.",
        "2. Decide the route. The chat picker means a 16 MB ceiling. A document means you can stay at 1080p with a higher bitrate.",
        "3. Set the frame size. 720p for chat, 1080p for documents. Keep the source aspect ratio unless you are deliberately reframing for status.",
        "4. Set the bitrate from the table above. A 45-second chat clip can afford about 2 Mbps total. A two-minute clip gets roughly 800 kbps.",
        "5. Export a single H.264 MP4 with AAC audio. Avoid intermediate files and extra passes.",
        "6. Check the file size on disk, not the estimate in the export dialog.",
        "7. Send it. If quality matters, use the document button instead of the media picker.",
      ],
    },
    {
      heading: "Common mistakes",
      paragraphs: [
        "Most bad WhatsApp videos are not caused by the app alone. They were set up to fail before upload.",
      ],
      bullets: [
        "Uploading 4K and trusting the app. WhatsApp throws away most of those pixels, and the result is often softer than a clean 720p export.",
        "Compressing twice. Export, send, download, edit, send again, and each pass adds artifacts. Keep the original.",
        "Choosing HEVC because the file is smaller. The recipient's phone may not decode it, and WhatsApp may transcode it anyway.",
        "Forgetting rotation. Phone clips carry a rotation flag. Some encoders drop it and the video arrives sideways.",
        "Filling the frame with small text. Chat playback is tiny and sometimes cropped, so thin captions disappear.",
        "Sending a three-minute status. Status is a 60-second format. Split the clip instead of letting the app cut it at a random point.",
      ],
    },
  ],
  faqs: [
    {
      question: "Why does my video look worse after WhatsApp compresses it?",
      answer:
        "WhatsApp re-encodes at a low bitrate. Starting from a clean 720p export gives the encoder less detail to damage than a sharp 4K master, which sounds backwards but holds in practice.",
    },
    {
      question: "What is the maximum file size for WhatsApp?",
      answer:
        "About 16 MB through the photo and video picker, and 2 GB as a document. Status clips are limited by duration more than by size.",
    },
    {
      question: "Does sending as a document really avoid compression?",
      answer:
        "Yes. WhatsApp stores and forwards the file as-is. The tradeoff is that the recipient sees a download card instead of an inline preview.",
    },
    {
      question: "Can I compress a video on my phone without installing an app?",
      answer:
        "Yes. Trim in Photos or Gallery, then use a browser-based compressor. Cutmoor does the encoding on your device, so the file is never uploaded.",
    },
  ],
};
