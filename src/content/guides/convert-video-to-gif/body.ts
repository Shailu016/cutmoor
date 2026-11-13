import type { GuideBody } from "../../types";

export const body: GuideBody = {
  sections: [
    {
      heading: "Why a 5-second GIF can be bigger than a 1-minute video",
      paragraphs: [
        "Modern video codecs such as H.264 store a full picture only now and then and describe every frame in between as small changes. GIF does almost none of that. Each frame is close to a complete image, and each image is limited to a palette of 256 colours. The result is a format that is simple to play everywhere and very inefficient to store.",
        "That is why the same moment can be 600 KB as an MP4 and 15 MB as a GIF. The length of the clip, its width, and its frame rate multiply together, so cutting any one of them shrinks the file far more than any quality slider can.",
      ],
      callout:
        "The three levers that matter, in order: duration, width, frame rate. Fix those before worrying about anything else.",
    },
    {
      heading: "The settings that keep a GIF sharable",
      paragraphs: [
        "Cutmoor's GIF export is tuned for the place most GIFs end up: chat apps, docs, and README files. It encodes at 12 frames per second, scales the width to 640 px while keeping the aspect ratio, and builds a custom 128-colour palette from your clip so colours stay close to the original instead of falling back to a generic web palette.",
      ],
      table: {
        headers: ["Setting", "Cutmoor uses", "Why"],
        rows: [
          ["Frame rate", "12 fps", "Smooth enough for reactions and UI demos, half the frames of 24 fps"],
          ["Width", "640 px (height follows)", "Sharp in chat and docs, a fraction of the pixels of 1080p"],
          ["Colours", "128, built from your clip", "A per-clip palette avoids banding on skin tones and gradients"],
          ["Dithering", "Ordered (Bayer)", "Smooths gradients without the shimmer of noisy dithering"],
          ["Looping", "Infinite", "GIFs are expected to loop"],
        ],
        caption: "These values come from the encoder settings in Cutmoor's Convert tool.",
      },
    },
    {
      heading: "Step by step",
      paragraphs: [
        "Trim first, then convert. Converting a whole recording and trimming the GIF afterwards wastes time and gives the encoder more frames to squeeze.",
      ],
      bullets: [
        "Open Trim video and cut the clip down to the moment you need. Aim for 2 to 6 seconds.",
        "Download the trimmed MP4. Trimming does not touch the visible quality of the part you keep.",
        "Open Convert video, add the trimmed clip, and choose GIF.",
        "Convert. The GIF is built in your browser and downloaded directly; the video never leaves your device.",
        "Check the file size. If it is still too large, trim another second or two before trying anything else.",
      ],
    },
    {
      heading: "How big is too big?",
      paragraphs: [
        "Limits change, but a few numbers are useful. Free Discord accounts can upload files up to 10 MB. GitHub shows images in issues and READMEs comfortably below 10 MB. Slack and most email clients accept larger files, but a GIF over 5 MB loads slowly on mobile data and may not autoplay.",
        "As a rough guide, a 640 px GIF at 12 fps lands between 1 and 3 MB per second of footage, depending on how much the picture moves. Static backgrounds and screen recordings compress best; fast camera movement and confetti compress worst.",
      ],
    },
    {
      heading: "When an MP4 loop is the better choice",
      paragraphs: [
        "Many sites that show \"GIFs\" actually play short muted MP4 videos, because they are often ten times smaller at better quality. If the destination accepts video, such as a website you control, X, LinkedIn, or most messaging apps, export an MP4 instead and let it loop.",
        "Keep GIF for places that only accept images: markdown files, some forums, email signatures, and documentation tools. There, the universal playback is worth the size.",
      ],
      callout:
        "Rule of thumb: if you can upload a video, upload a video. Use GIF when an image is the only thing allowed.",
    },
    {
      heading: "Getting a cleaner result",
      paragraphs: [
        "A few habits make a noticeable difference without changing any setting.",
      ],
      bullets: [
        "Record or crop tightly. A 640 px GIF of a small region looks much sharper than a 640 px GIF of a whole 4K screen.",
        "Avoid fades and slow zooms. Every frame changes everywhere, which is the worst case for GIF.",
        "Prefer flat colours for screen recordings. Light mode UIs with simple backgrounds compress far better than wallpapers and video in the background.",
        "Plan the loop. Start and end on a similar frame so the jump back to the beginning is invisible.",
      ],
    },
  ],
  faqs: [
    {
      question: "Does a GIF keep the sound?",
      answer:
        "No. GIF is an image format and has no audio track. If the sound matters, export an MP4 instead.",
    },
    {
      question: "Why does my GIF look grainy?",
      answer:
        "GIF can only show 256 colours per frame. Gradients such as skies, skin, and shadows are approximated with patterns of nearby colours, which looks grainy up close. Cutmoor builds a palette from your clip to keep this as subtle as possible, but footage with smooth gradients will always look better as video.",
    },
    {
      question: "Can I make a GIF from an iPhone video?",
      answer:
        "Yes. MOV files from an iPhone are accepted directly. Trim the clip first, then choose GIF in Convert video.",
    },
    {
      question: "Is my video uploaded to make the GIF?",
      answer:
        "No. The conversion runs in your browser with a WebAssembly build of FFmpeg. The video stays on your device, and the GIF is created there too.",
    },
  ],
};
