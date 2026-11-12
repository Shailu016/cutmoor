import type { Guide } from "./types";

/** Guides 15–17: GIFs, still frames, and resizing images. */
export const GUIDES_D: Guide[] = [
  {
    slug: "convert-video-to-gif",
    title: "How to convert a video to a GIF that is small and still looks good",
    description:
      "Turn a short clip into a looping GIF without a 40 MB file. Why GIFs get so large, the length, width, and frame rate that keep them sharable, and when an MP4 loop is the better choice.",
    excerpt:
      "A GIF stores every frame as a full picture with at most 256 colours. Keep it short, narrow, and at a low frame rate, and it stays small enough to share.",
    category: "Conversion",
    published: "2026-11-13",
    modified: "2026-11-13",
    readingMinutes: 7,
    tools: ["convert", "trim"],
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
  },
  {
    slug: "extract-frame-from-video",
    title: "How to save a frame from a video as a high-quality image",
    description:
      "Pull a sharp still from any video for a thumbnail, cover, or screenshot. How to pick the right moment, when to choose PNG or JPG, and why some frames come out blurry or black.",
    excerpt:
      "A screenshot of a playing video gives you a blurry, screen-sized image. Exporting the frame itself gives you the full resolution of the original recording.",
    category: "Editing",
    published: "2026-11-13",
    modified: "2026-11-13",
    readingMinutes: 6,
    tools: ["frame", "trim"],
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
  },
  {
    slug: "resize-image-without-losing-quality",
    title: "How to resize an image without losing quality",
    description:
      "Make images smaller or change their shape without blur or stretching. Why shrinking is safe and enlarging is not, crop versus pad, and the right format for the result.",
    excerpt:
      "Shrinking an image almost never hurts it. Enlarging, stretching, and saving the result as a low-quality JPG are what make resized images look bad.",
    category: "Editing",
    published: "2026-11-13",
    modified: "2026-11-13",
    readingMinutes: 7,
    tools: ["resize-image", "compress-image"],
    sections: [
      {
        heading: "Down is safe, up is not",
        paragraphs: [
          "Resizing a 4000 × 3000 photo down to 1080 × 810 throws away pixels you could not see on a phone screen anyway. Done with a good scaling filter, the result looks just as sharp at its new size, and often sharper, because small noise averages out.",
          "Resizing up is different. A 600 × 400 image enlarged to 1920 × 1280 has to invent the missing pixels by blending neighbours, which looks soft. No resizer can add detail that was never captured. If you need a large image, start from the largest original you have.",
        ],
        callout:
          "Always resize from the original file, not from a copy that was already shrunk or sent through a messaging app.",
      },
      {
        heading: "Changing the shape: crop or pad",
        paragraphs: [
          "Most quality problems come from changing an image's shape, not its size. Squeezing a landscape photo into a square frame without care either stretches faces or cuts off the subject. Cutmoor never stretches. You choose one of two honest options.",
        ],
        table: {
          headers: ["Mode", "What happens", "Best for"],
          rows: [
            ["Crop to fill", "Scales the image to cover the frame and trims the edges from the centre", "Photos where the subject is near the middle"],
            ["Pad to fit", "Keeps the whole image and fills the empty space with a colour or transparency", "Screenshots, diagrams, logos, product shots"],
          ],
        },
      },
      {
        heading: "Step by step",
        paragraphs: [
          "Resize image runs in your browser and accepts JPG, PNG, WebP, HEIC, AVIF, GIF, BMP, and SVG files.",
        ],
        bullets: [
          "Drop the image in. The original dimensions are shown so you can see whether you are shrinking or enlarging.",
          "Pick a preset, such as Instagram portrait 1080 × 1350, Story 1080 × 1920, YouTube thumbnail 1280 × 720, or link preview 1200 × 630, or type an exact size.",
          "Choose Crop to fill or Pad to fit and check the preview, especially that the subject is not cut off.",
          "Choose the output format and quality, then export.",
        ],
      },
      {
        heading: "Choose the right format for the result",
        paragraphs: [
          "The format and quality you export at matter as much as the size. A perfectly resized photo saved as a low-quality JPG will still look smeared.",
        ],
        bullets: [
          "JPG for photographs. A quality around 80 to 85 is visually indistinguishable from the original for most photos and much smaller.",
          "PNG for screenshots, text, logos, and anything with transparency. It is lossless, so edges stay crisp.",
          "WebP for websites, where supported. It is usually smaller than JPG at the same visual quality and supports transparency.",
        ],
        callout:
          "If the file is still too large after resizing, use Compress image as the last step rather than lowering the size further than you need.",
      },
      {
        heading: "Common size mistakes",
        paragraphs: [
          "A few habits cause most disappointing results.",
        ],
        bullets: [
          "Resizing several times in a row. Each JPG save adds a little loss; go from the original to the final size in one step.",
          "Uploading a giant image and letting the platform shrink it. Social networks compress aggressively; giving them exactly the size they display keeps you in control.",
          "Ignoring safe areas. Stories and Reels cover the top and bottom with interface elements, so keep text and faces in the middle.",
          "Enlarging a small logo for a banner. Ask for a vector (SVG) or a larger original instead.",
        ],
      },
    ],
    faqs: [
      {
        question: "Does resizing reduce file size?",
        answer:
          "Usually, yes. Fewer pixels means less data. Going from a 12-megapixel photo to 1080 px wide often cuts the file by 80 to 90 percent before any extra compression.",
      },
      {
        question: "Can I resize without changing the aspect ratio?",
        answer:
          "Yes. Use a custom size that keeps the same proportions, or Pad to fit, which always keeps the whole image unchanged and adds space around it.",
      },
      {
        question: "Will transparency be kept?",
        answer:
          "Yes, when you export as PNG, or as WebP in a browser that supports it. JPG has no transparency, so transparent areas are filled with the background colour you choose.",
      },
      {
        question: "Are my photos uploaded?",
        answer:
          "No. Resizing happens in your browser with the canvas API. The image never leaves your device.",
      },
    ],
  },
];
