import type { GuideBody } from "../../types";

export const body: GuideBody = {
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
};
