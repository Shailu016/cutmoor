import type { GuideBody } from "../../types";

export const body: GuideBody = {
  sections: [
    {
      heading: "Why a screenshot is not the same as a frame",
      paragraphs: [
        "Pressing the screenshot key while a video plays captures whatever is on your screen: the player scaled to your window, any controls on top, and often a frame that is half-way through a transition. On a phone it is usually smaller than the video itself.",
        "Extracting the frame reads the picture straight from the video file. A 1080p recording gives a 1920 × 1080 image, a 4K recording gives 3840 × 2160, and a vertical Reel gives 1080 × 1920. Nothing is scaled, and nothing from the player interface is in the way.",
      ],
    },
    {
      heading: "Step by step",
      paragraphs: [
        "Cutmoor's Save a frame tool works on MP4, MOV, WebM, MKV, and AVI files, and the whole process happens in your browser.",
      ],
      bullets: [
        "Find the moment in any video player and note the time shown, for example 0:03.5 for three and a half seconds.",
        "Open Save a frame and drop the video in. The clip's duration is shown so you can check the timestamp is inside it.",
        "Enter the timestamp.",
        "Choose PNG or JPG.",
        "Save the frame. It downloads at the video's native resolution.",
      ],
      callout:
        "Moving subjects blur. Step a few tenths of a second either side of the moment you want: the sharpest frame is often just before or after the peak of the action.",
    },
    {
      heading: "PNG or JPG?",
      paragraphs: [
        "Both formats are exported at the same resolution. The difference is how they store detail.",
      ],
      table: {
        headers: ["Use", "Best format", "Why"],
        rows: [
          ["Screen recordings, slides, text", "PNG", "Lossless; keeps edges and small text crisp"],
          ["Logos and graphics", "PNG", "No compression artefacts around flat colours"],
          ["Photo-like footage for the web", "JPG", "Much smaller files with no visible loss at high quality"],
          ["Thumbnail you will edit further", "PNG", "Avoids compressing twice"],
        ],
      },
    },
    {
      heading: "Making a YouTube or social thumbnail",
      paragraphs: [
        "YouTube recommends thumbnails at 1280 × 720 and under 2 MB. A frame from a 1080p video is larger than that, which is good: you can resize down without losing sharpness. Save the frame as PNG, then open Resize image and choose the YouTube thumbnail preset, or the Instagram and Story presets for social covers.",
        "Only use frames from video you own or have permission to use, and from people who have agreed to appear. A thumbnail is a public image even when the video is unlisted.",
      ],
    },
    {
      heading: "Why the frame is blurry or black",
      paragraphs: [
        "Most problems come from the video itself rather than the export.",
      ],
      bullets: [
        "Motion blur is recorded into the frame. Phones in low light use slow shutter speeds, so anything moving smears. Choose a calmer moment.",
        "A black frame usually means the timestamp is before the first picture or after the end. Try a second later, or check the duration.",
        "Some videos can only be decoded from certain keyframes, so the exported frame is the nearest one the decoder can produce.",
        "Heavily compressed sources, such as videos saved from messaging apps, contain blocky detail that no export can recover. Use the original recording when you have it.",
      ],
    },
  ],
  faqs: [
    {
      question: "Can I extract several frames at once?",
      answer:
        "Save a frame exports one still at a time, at full resolution. Repeat with a new timestamp for each image you need.",
    },
    {
      question: "Does the image keep the video's quality?",
      answer:
        "Yes. The frame is decoded from the file at its native resolution. PNG keeps it exactly; JPG is saved at high quality, so differences are not visible in normal use.",
    },
    {
      question: "Will a vertical video give a vertical image?",
      answer:
        "Yes. The orientation of the source is kept, so a 1080 × 1920 video produces a 1080 × 1920 image.",
    },
    {
      question: "Is my video uploaded?",
      answer:
        "No. Decoding happens in your browser. The video and the saved image both stay on your device.",
    },
  ],
};
