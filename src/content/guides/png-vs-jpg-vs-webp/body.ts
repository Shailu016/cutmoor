import type { GuideBody } from "../../types";

export const body: GuideBody = {
  sections: [
    {
      heading: "The one-minute answer",
      paragraphs: [
        "Use JPG for photographs and anything that must open on any device. Use PNG for screenshots, diagrams, logos, and images with transparency. Use WebP for websites when you control the audience and want a smaller file. Those three rules cover most everyday decisions.",
        "The longer answer is about what each format does with pixels. JPG throws information away to make the file smaller. PNG keeps every pixel but compresses the file losslessly. WebP can do either, and adds transparency and animation. None of them is universally better.",
      ],
      table: {
        headers: ["Format", "Compression", "Transparency", "Best for", "Watch out for"],
        rows: [
          ["JPG", "Lossy", "No", "Photos, email, print, universal uploads", "Artifacts around text and sharp edges"],
          ["PNG", "Lossless", "Yes", "Screenshots, logos, diagrams, transparency", "Very large photo files"],
          ["WebP", "Lossy or lossless", "Yes", "Web images, smaller photo delivery", "Older editors; Safari cannot encode it from canvas"],
          ["AVIF", "Lossy or lossless", "Yes", "Modern web delivery", "Limited encoder support; no canvas export"],
          ["GIF", "Lossless, 256 colours", "Binary", "Short simple animations", "Huge files; poor colour and gradients"],
          ["HEIC", "Lossy, HEVC-based", "No", "iPhone photo storage", "Poor compatibility outside Apple devices"],
        ],
        caption:
          "Browser support for displaying a format is not the same as support for creating it. Cutmoor can display AVIF but cannot encode it from a canvas.",
      },
    },
    {
      heading: "How JPG compression works",
      paragraphs: [
        "JPG divides the image into blocks, transforms them into frequency information, and discards the detail the eye is least likely to notice. Higher quality keeps more of that detail; lower quality throws more away. The result is a small file that looks good on a photo and bad on a screenshot.",
        "Sharp edges are the weak point. Black text on a white background is exactly the kind of high-contrast detail the format struggles with, which is why a JPG screenshot often has coloured halos around letters. The format also has no alpha channel, so transparent pixels must be filled with a colour before export.",
      ],
      bullets: [
        "Quality 85–92 is visually clean for most photographs.",
        "Below about 70, gradients and skin tones start to band and block.",
        "Each re-save adds another generation of loss; keep an untouched original.",
        "Chroma subsampling reduces colour detail before the main compression even starts.",
      ],
    },
    {
      heading: "How PNG compression works",
      paragraphs: [
        "PNG is lossless: the decoded image is exactly the encoded image. It compresses with a filter and DEFLATE, which works well on flat colours, repeated patterns, and text. That is why a screenshot of a document can be a few hundred kilobytes while a photograph of the same dimensions can be several megabytes.",
        "PNG carries an alpha channel, so it is the default for logos and interface graphics that need to sit on an unknown background. The tradeoff is size. A 12 MP photo saved as PNG is often five to ten times larger than a high-quality JPG with no visible benefit for the viewer.",
      ],
      callout:
        "PNG is not a quality upgrade for a photo. Converting a JPG to PNG cannot recover detail that the JPG already discarded; it only stops the next save from losing more.",
    },
    {
      heading: "Where WebP fits",
      paragraphs: [
        "WebP was designed for the web. In lossy mode it typically produces a file 25–35 percent smaller than JPG at comparable visual quality. In lossless mode it usually beats PNG on graphics, and it supports transparency in both modes. Every current major browser can display it.",
        "The catch is creation, not display. Safari can render WebP but cannot encode it from a canvas; asking for image/webp silently returns a PNG. That is why Cutmoor probes the encoder at runtime and hides WebP export where it is unavailable. Use JPG or PNG in Safari, or convert in Chrome, Edge, or Firefox.",
      ],
      bullets: [
        "WebP is a good default for website images when your audience uses modern browsers.",
        "Some older desktop editors, print workflows, and upload forms still reject it.",
        "Converting WebP to JPG is easy; converting back cannot recover the original quality.",
        "A WebP file with a .jpg extension is still WebP. Check the actual format if an app refuses it.",
      ],
    },
    {
      heading: "Transparency, metadata, and colour",
      paragraphs: [
        "Transparency is the clearest dividing line. PNG and WebP support an alpha channel. JPG does not. If a logo with a transparent background is exported to JPG, the empty pixels become white or whatever colour the encoder chooses, and the result cannot be placed on a dark page without a visible box.",
        "Metadata is the second difference. JPG files often carry EXIF data: camera model, exposure, capture time, and sometimes GPS coordinates. PNG carries less by default. WebP can carry metadata too. A canvas re-encode, as used by Cutmoor, strips most metadata and applies orientation to the pixels, which is good for privacy but removes copyright and colour-profile fields as well.",
        "Colour profiles matter for print and for wide-gamut displays. A browser re-encode usually works in sRGB. If exact colour is critical, keep the original and use a colour-managed editor rather than a quick web conversion.",
      ],
    },
    {
      heading: "A practical decision tree",
      paragraphs: [
        "If you only remember one sequence, use this one.",
      ],
      bullets: [
        "Is it a photograph? Choose JPG, or WebP if it is going on a website you control.",
        "Is it a screenshot, logo, chart, or image with transparency? Choose PNG, or lossless WebP for the web.",
        "Does an app or a person need to open it with zero friction? Choose JPG.",
        "Is the file too large? Reduce the dimensions before lowering quality.",
        "Are you converting an already-compressed photo? Accept that the next encode adds a small loss, and keep the original.",
      ],
      table: {
        headers: ["Destination", "Recommended format", "Why"],
        rows: [
          ["Instagram or Facebook post", "JPG", "Universally accepted; small enough after resize"],
          ["Website hero image", "WebP with JPG fallback", "Smaller delivery; broad browser support"],
          ["App icon or logo", "PNG", "Transparency and crisp edges"],
          ["Email attachment", "JPG", "Small and opens everywhere"],
          ["Print or archive", "TIFF or PNG from the original", "Avoid stacking lossy generations"],
          ["Windows or Android upload form", "JPG", "HEIC and WebP are often rejected"],
        ],
      },
    },
    {
      heading: "What conversion can and cannot fix",
      paragraphs: [
        "Converting a PNG to JPG removes transparency and may introduce artifacts, but it can turn a 6 MB screenshot into a 300 KB file. Converting a JPG to PNG does not improve quality; it preserves the current quality and usually makes the file larger. Converting a WebP to JPG improves compatibility at the cost of a second lossy encode.",
        "If the goal is a smaller file, conversion is only half the job. Reducing the dimensions and choosing the right quality setting usually matters more than the container. A 4000 px JPG at quality 95 can be larger than a 1600 px JPG at quality 85, and the smaller one will look just as sharp on a phone.",
      ],
    },
  ],
  faqs: [
    {
      question: "Is PNG better quality than JPG?",
      answer:
        "PNG is lossless, so it preserves the exact pixels it is given. JPG is lossy. That does not mean a PNG is always better: if the source is already a JPG, converting it to PNG keeps the existing artifacts and makes the file larger. For photographs, a high-quality JPG is the better delivery format.",
    },
    {
      question: "Is WebP smaller than JPG?",
      answer:
        "Usually yes, by roughly 25–35 percent at comparable visual quality. The difference depends on the content and the encoder. WebP's advantage is largest for photos on the web; the disadvantage is that some older software and workflows do not accept it.",
    },
    {
      question: "Can I convert JPG to PNG without losing quality?",
      answer:
        "You can convert without adding a new loss, because PNG is lossless. But you cannot recover detail the JPG already discarded. The PNG will usually be much larger and will look the same.",
    },
    {
      question: "Why does my transparent logo turn white?",
      answer:
        "The file was exported as JPG, which has no alpha channel. Choose PNG or WebP, or set the background colour deliberately before exporting to JPG.",
    },
    {
      question: "Does converting an image remove EXIF and GPS data?",
      answer:
        "A canvas-based conversion such as Cutmoor's does, because the image is redrawn and re-encoded rather than copied. The pixels remain, but camera, GPS, and most other metadata are not carried over. Orientation is applied before export so the image still appears upright.",
    },
    {
      question: "Why can't Safari export WebP?",
      answer:
        "Safari can display WebP but its canvas implementation cannot encode it. When asked for image/webp, it returns a PNG instead. Cutmoor checks the actual blob type and disables WebP export rather than producing a mislabeled file.",
    },
  ],
};
