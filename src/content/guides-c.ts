import type { Guide } from "./types";

/** Guides 11–14: the image cluster. */
export const GUIDES_C: Guide[] = [
  {
    slug: "social-media-image-sizes",
    title: "Social media image sizes for 2026 (and why the feed still crops them)",
    description:
      "Current working image sizes for Instagram, Facebook, X, LinkedIn, YouTube, TikTok, Pinterest, and link previews, plus the crop rules that decide what survives.",
    excerpt:
      "A 1080 × 1350 photo is the safe portrait post for Instagram. A 1200 × 630 image is the safe link preview. Everything else is a crop decision.",
    category: "Social media",
    published: "2026-11-11",
    modified: "2026-11-11",
    readingMinutes: 8,
    tools: ["resize-image", "compress-image"],
    sections: [
      {
        heading: "Start with the crop, not the pixel count",
        paragraphs: [
          "Every platform recommends a size, then crops the image again in at least one place: the feed, the profile grid, the Stories viewer, or a link card. The recommended size is the canvas you should upload. The crop is what actually decides whether your subject and text survive.",
          "A portrait 4:5 image is the safest shape for a feed post because it uses more vertical space without being cut to a square in the grid. A 9:16 image is the right shape for Stories and Reels covers, but the top and bottom are often covered by interface elements. Keep the important part in the middle.",
        ],
        callout:
          "Design for the smallest crop the platform will show, not for the full canvas you upload. The extra pixels are breathing room, not guaranteed visibility.",
      },
      {
        heading: "The working sizes",
        paragraphs: [
          "These are the sizes that behave well in current feeds and upload forms. Platforms change recommendations without much notice, so treat this as a practical baseline and check the platform's own help centre before a paid campaign.",
        ],
        table: {
          headers: ["Placement", "Working size", "Aspect ratio", "Notes"],
          rows: [
            ["Instagram feed (portrait)", "1080 × 1350", "4:5", "Best feed coverage; grid crops to square"],
            ["Instagram feed (square)", "1080 × 1080", "1:1", "Safe, familiar, less vertical space"],
            ["Instagram Story / Reel cover", "1080 × 1920", "9:16", "Keep text away from top and bottom edges"],
            ["Facebook feed image", "1080 × 1350", "4:5", "Link posts often use 1.91:1 instead"],
            ["Facebook link preview", "1200 × 630", "1.91:1", "Same shape as Open Graph"],
            ["X post image", "1600 × 900", "16:9", "Timeline may crop to a wider card"],
            ["X header", "1500 × 500", "3:1", "Profile photo overlays the lower left"],
            ["LinkedIn feed image", "1200 × 1200", "1:1", "Vertical 4:5 also works; link cards use 1.91:1"],
            ["LinkedIn company cover", "1128 × 191", "5.9:1", "Very wide; avoid small text"],
            ["YouTube thumbnail", "1280 × 720", "16:9", "Under 2 MB; duration badge sits bottom right"],
            ["YouTube channel banner", "2048 × 1152", "16:9", "Safe area is much smaller on phones"],
            ["TikTok video cover", "1080 × 1920", "9:16", "Profile grid crops to a narrower tile"],
            ["Pinterest pin", "1000 × 1500", "2:3", "Tall pins dominate the feed"],
            ["Open Graph / link preview", "1200 × 630", "1.91:1", "Used by Facebook, LinkedIn, Slack, Discord, and iMessage"],
          ],
          caption:
            "Sizes are in pixels. Upload the largest version the platform accepts, then let it scale down; upscaling a small image always looks soft.",
        },
      },
      {
        heading: "Why the same photo looks different in every app",
        paragraphs: [
          "A feed is not a file viewer. It is a layout engine with its own crop, compression, and background rules. Instagram may show a 4:5 post at full height in the feed but crop it to a square in the profile grid. X may show a 16:9 image at full width in one client and crop it to a shorter card in another. LinkedIn uses different crops for a feed image, a link card, and a company page.",
          "The practical answer is to keep the subject centred and keep text out of the outer 10 percent of the image. If a design only works when the full canvas is visible, it will break somewhere. If it works inside a square, it will survive almost every crop.",
        ],
        bullets: [
          "Centre the subject; assume the left and right edges may be trimmed.",
          "Keep captions and logos inside the middle 80 percent of the frame.",
          "Do not put essential text in the bottom 12 percent of a Story; the reply bar covers it.",
          "Leave room at the top of a YouTube thumbnail for the title overlay in some embeds.",
          "Check the image at phone size, not only on a desktop monitor.",
        ],
      },
      {
        heading: "File size and format",
        paragraphs: [
          "Most platforms accept JPG, PNG, and WebP, and re-encode whatever you upload. A 12 MB PNG photo does not arrive as a 12 MB PNG; it arrives looking worse than a well-prepared 300 KB JPG. Preparing the file yourself gives you control over the result instead of handing that control to an unknown encoder.",
          "Use JPG for photographs, PNG for screenshots and graphics with transparency, and WebP when the destination supports it and you want a smaller file. Keep the long edge at the recommended size rather than uploading a 6000 px original. A 1080 px image is already more than a phone screen can show.",
        ],
        table: {
          headers: ["Content", "Format", "Suggested quality", "Typical size"],
          rows: [
            ["Photo post", "JPG", "80–88", "150–400 KB at 1080 px"],
            ["Screenshot or diagram", "PNG", "Lossless", "100–600 KB at 1080 px"],
            ["Transparent logo", "PNG or WebP", "Lossless", "20–150 KB"],
            ["Link preview", "JPG", "82–88", "80–200 KB at 1200 × 630"],
            ["YouTube thumbnail", "JPG", "85–90", "Under 2 MB; often 150–400 KB"],
          ],
          caption:
            "Quality numbers refer to the encoder's quality setting. They are guidance, not a guarantee across different encoders.",
        },
      },
      {
        heading: "A repeatable export recipe",
        paragraphs: [
          "The order of operations matters more than any single setting. Resize once, sharpen lightly if needed, and encode once. Re-saving the same JPEG repeatedly adds a generation of loss each time.",
        ],
        bullets: [
          "Start from the largest original you have. Never upscale a small image to reach a recommended size.",
          "Crop to the target aspect ratio first. Decide what you are willing to lose before you resize.",
          "Resize to the exact working size, for example 1080 × 1350 for a portrait post.",
          "Apply sharpening after resizing, not before. A light pass compensates for the softness introduced by scaling.",
          "Export as JPG at 80–88, or PNG for graphics. Check the result at 100 percent and at phone size.",
          "Keep the layered or original file. The exported JPG is a delivery copy, not an archive.",
        ],
      },
      {
        heading: "What to do when a platform rejects the file",
        paragraphs: [
          "Upload forms usually fail for one of four reasons: the file is over the size limit, the dimensions are below the minimum, the format is not accepted, or the aspect ratio is outside the allowed range. The error message often names only one of them.",
          "Check the file size first, then the pixel dimensions. A 200 KB image can still be rejected for being 320 px wide. If the format is the problem, convert a copy to JPG and keep the original. If the aspect ratio is the problem, pad the image rather than cropping away the subject.",
        ],
        callout:
          "When in doubt, upload a JPG at the recommended dimensions under the size limit. It is the least surprising combination across every platform.",
      },
    ],
    faqs: [
      {
        question: "What is the best image size for Instagram in 2026?",
        answer:
          "Use 1080 × 1350 (4:5) for a portrait feed post, 1080 × 1080 for a square post, and 1080 × 1920 (9:16) for a Story or Reel cover. Instagram re-compresses uploads, so start from a sharp source at or above those dimensions.",
      },
      {
        question: "Why does my photo look blurry after posting?",
        answer:
          "Usually because the source was too small, or because it was upscaled to reach the recommended size. Upload a native-resolution image at the platform's working size and avoid repeated saves. Platforms also apply their own compression, which softens fine detail.",
      },
      {
        question: "Is 1080 × 1080 still good for Instagram?",
        answer:
          "Yes, but a 4:5 portrait post occupies more vertical space in the feed. The square version is safer for the profile grid and for cross-posting to LinkedIn or Facebook.",
      },
      {
        question: "What size should a link preview image be?",
        answer:
          "1200 × 630 (1.91:1) is the most widely used Open Graph size. It works for Facebook, LinkedIn, Slack, Discord, and many other unfurlers. Keep text large and centred because some cards crop the edges.",
      },
      {
        question: "Should I upload PNG or JPG to social media?",
        answer:
          "JPG for photos, PNG for screenshots, logos, and anything with transparency. Most platforms re-encode both, so the practical difference is how clean the source looks after their compression, not the extension you upload.",
      },
    ],
  },
  {
    slug: "png-vs-jpg-vs-webp",
    title: "PNG vs JPG vs WebP: which image format should you use?",
    description:
      "A plain comparison of compression, transparency, compatibility, and file size, with practical rules for screenshots, photos, logos, and the web.",
    excerpt:
      "PNG is lossless, JPG is universal, and WebP is usually smaller. The right choice depends on what is in the image and where it is going.",
    category: "Conversion",
    published: "2026-11-11",
    modified: "2026-11-11",
    readingMinutes: 7,
    tools: ["convert-image", "compress-image"],
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
  },
  {
    slug: "compress-image-without-visible-quality-loss",
    title: "How to compress an image without visible quality loss",
    description:
      "Why image files get large, how to hit a target size with the least visible damage, and the settings that matter for photos, screenshots, and web images.",
    excerpt:
      "Dimensions decide file size more than the quality slider. Resize first, then compress. A 4000 px photo shown at 1200 px is mostly wasted bytes.",
    category: "Compression",
    published: "2026-11-11",
    modified: "2026-11-11",
    readingMinutes: 7,
    tools: ["compress-image", "resize-image"],
    sections: [
      {
        heading: "Why an image is large",
        paragraphs: [
          "An image file is a description of pixels. More pixels means more data, and a busier image compresses less efficiently than a plain one. A 4000 × 3000 photo contains 12 million pixels. At three bytes per pixel before compression, that is 36 MB of raw data; a good JPG encoder brings it down to a few megabytes by discarding detail the eye is unlikely to notice.",
          "That gives you two levers: the number of pixels and the amount of detail kept per pixel. Most people reach for the quality slider first. The bigger saving is usually the dimensions. If an image will be displayed at 1200 px wide, storing it at 4000 px is wasted space in every direction.",
        ],
        callout:
          "Resize to the largest size the image will actually be displayed at, then compress. Doing it in the other order throws away quality you could have kept.",
      },
      {
        heading: "The quality slider is not linear",
        paragraphs: [
          "JPEG quality is an encoder setting, not a percentage of visible quality. The file size falls quickly as you move from 95 to 85, then more slowly. The visible difference between 90 and 80 is often negligible on a photo. The difference between 80 and 60 is usually obvious in gradients, skin, and fine texture.",
          "For photographs, 80–88 is a sensible range. For images with text, sharp edges, or large flat areas, JPG is the wrong format and no quality setting will fully hide the artifacts. Use PNG for those instead.",
        ],
        table: {
          headers: ["Quality", "Typical visual result", "When to use"],
          rows: [
            ["90–95", "Very clean; large file", "Print, archival delivery, high-value hero images"],
            ["80–88", "Clean at normal viewing size", "Most web and social images"],
            ["70–79", "Slight softening; acceptable for thumbnails", "Small previews, email, tight size limits"],
            ["50–69", "Visible artifacts in gradients and detail", "Last resort when the target is extremely small"],
            ["Below 50", "Blocking, banding, colour shifts", "Avoid for anything a person will inspect"],
          ],
          caption:
            "Numbers are a starting point. Always check the result at 100 percent and at the size it will be viewed.",
        },
      },
      {
        heading: "Target-size compression, explained",
        paragraphs: [
          "A target size is a constraint, not a setting. To hit it, the tool has to search. For JPG and WebP, Cutmoor encodes the image at several quality levels and narrows in on the highest one that stays under the target. If even the lowest sensible quality is too large, it reduces the dimensions in steps and tries again.",
          "That is why a target-size result sometimes says the output was reduced to a smaller size. It is not a failure; it is the honest way to meet the constraint. The alternative, returning a file over the target and calling it done, would be worse.",
          "PNG is lossless, so the quality slider does not apply. A PNG can only reach a target by reducing dimensions or by using a palette. For photographs, converting to JPG or WebP is usually the better move.",
        ],
        bullets: [
          "A 200 KB target is comfortable for a 1080 px photo.",
          "A 50 KB target at full resolution will show damage; reduce dimensions first.",
          "A 1 MB target is generous for a web hero image and usually easy to hit.",
          "If the result is still over target, the tool should say so, not silently label it as success.",
        ],
      },
      {
        heading: "Screenshots, graphics, and transparency",
        paragraphs: [
          "Screenshots are mostly text and flat colour. JPG is a poor fit: the artifacts appear exactly where the eye is most sensitive, around letters and interface edges. PNG keeps them crisp and often compresses the flat areas well. If a screenshot is 3 MB, the first question is whether it needs to be that large, not whether the quality can go lower.",
          "For graphics with transparency, PNG or WebP are the only options that preserve the alpha channel. JPG will fill transparent pixels with a solid colour. If the destination requires JPG, choose the fill colour deliberately instead of accepting white by default.",
        ],
        table: {
          headers: ["Image type", "Best format", "Recommended move"],
          rows: [
            ["Phone photo", "JPG or WebP", "Cap the long edge at 1600–2048 px, quality 80–86"],
            ["Screenshot with text", "PNG", "Keep lossless; crop unnecessary areas"],
            ["Logo with transparency", "PNG or WebP", "Keep lossless; export at display size"],
            ["Product photo on white", "JPG", "Resize to 1600 px, quality 85"],
            ["Detailed artwork", "WebP or PNG", "Prefer lossless if the file size is acceptable"],
          ],
        },
      },
      {
        heading: "A workflow that protects quality",
        paragraphs: [
          "The safest compression workflow is boring and repeatable. It also takes less than a minute per image once the dimensions are known.",
        ],
        bullets: [
          "Keep the original file. Work on a copy, and never overwrite the only version.",
          "Crop to the final aspect ratio before resizing.",
          "Resize to the largest display size, not to the source size.",
          "Choose the format based on content: JPG for photos, PNG for text and transparency.",
          "Use a target size or a quality around 82–88, not 100.",
          "Inspect the result at 100 percent, then at the size it will appear on screen.",
          "If it looks soft, raise the quality slightly or reduce the dimensions further. Do not sharpen a badly compressed file.",
        ],
      },
      {
        heading: "Common mistakes",
        paragraphs: [
          "Most compression problems are self-inflicted, and most are reversible if the original is kept.",
        ],
        bullets: [
          "Compressing an already compressed file repeatedly, adding a generation of loss each time.",
          "Uploading a 6000 px image when the page displays it at 1200 px.",
          "Using JPG for screenshots and then blaming the tool for fuzzy text.",
          "Setting quality to 100 and wondering why the file is still large.",
          "Converting a photo to PNG because PNG sounds lossless, then uploading a 20 MB file.",
          "Judging the result on a phone preview that has already been scaled down.",
        ],
        callout:
          "If the file must be under a hard limit, reduce dimensions first and quality second. The result usually looks better than crushing quality at full resolution.",
      },
    ],
    faqs: [
      {
        question: "Can I compress an image without losing any quality?",
        answer:
          "Only if the format is lossless and the file was not already compressed lossily. PNG and lossless WebP can be re-encoded without changing pixels, but the size reduction is limited. For photos, some loss is unavoidable when the file gets smaller; the goal is to keep it below the threshold where a person notices.",
      },
      {
        question: "What is the best image quality setting?",
        answer:
          "For JPG photos, 80–88 is a good range. 90–95 is useful for print or archival delivery. Below 70, artifacts become visible in gradients and fine detail. For PNG, quality does not apply because the format is lossless.",
      },
      {
        question: "Why is my compressed image still large?",
        answer:
          "The dimensions are probably too high, or the content is very detailed. A 4000 px photo will stay large even at low quality. Reduce the long edge to the size it will be displayed at, then compress again.",
      },
      {
        question: "Should I compress before or after resizing?",
        answer:
          "Resize first, then compress. Resizing reduces the number of pixels the encoder has to describe, which usually saves more bytes than lowering quality. It also avoids compressing detail that will be thrown away.",
      },
      {
        question: "Does compressing an image remove EXIF data?",
        answer:
          "A canvas-based re-encode does, including GPS coordinates and camera details. If you need to preserve metadata, keep the original file and use a metadata-aware editor for the archive copy.",
      },
    ],
  },
  {
    slug: "heic-to-jpg-guide",
    title: "HEIC to JPG: why iPhone photos need converting (and how to do it safely)",
    description:
      "What HEIC is, why Windows and Android struggle to open it, how to convert without losing more quality than necessary, and what happens to location data.",
    excerpt:
      "HEIC is an efficient Apple format built on HEVC. It is smaller than JPG, but many apps still refuse it. Converting to JPG is a compatibility fix, not an upgrade.",
    category: "Conversion",
    published: "2026-11-11",
    modified: "2026-11-11",
    readingMinutes: 8,
    tools: ["heic-to-jpg", "convert-image"],
    sections: [
      {
        heading: "What HEIC actually is",
        paragraphs: [
          "HEIC is the still-image flavour of HEIF, a container format that can hold images encoded with HEVC (H.265) or other codecs. Apple adopted it with iOS 11 and macOS High Sierra, and iPhones have used it by default ever since. The appeal is efficiency: HEIC typically stores the same visual quality in roughly half the bytes of a comparable JPG.",
          "The name is slightly loose. Strictly, HEIC is the HEVC-coded variant, while HEIF is the container. A file may be labelled .heic or .heif and contain similar data. Apple uses both extensions depending on the device and the export path.",
        ],
        callout:
          "HEIC is a container, not a single codec. That is why one HEIC file opens and another fails: the decoder may support the container but not the specific codec or profile inside it.",
      },
      {
        heading: "Why Windows, Android, and upload forms reject it",
        paragraphs: [
          "Compatibility is the whole problem. macOS and iOS can decode HEIC natively. Windows does not include a decoder by default on every edition, and many Android apps and web upload forms never added support. The file is valid; the software simply does not know what to do with it.",
          "A web browser makes this more confusing. Safari on Apple platforms can decode HEIC through the operating system. Chrome, Edge, and Firefox generally cannot, so a photo that opens fine in the iPhone Photos app will show a broken image or a generic error when selected in a browser on Windows.",
        ],
        bullets: [
          "Windows may need the HEIF Image Extensions package, and even then app support varies.",
          "Android support depends on the manufacturer and the app, not just the OS version.",
          "Many job portals, government forms, and email clients still accept only JPG or PNG.",
          "Social platforms often accept HEIC from the iPhone app but reject it from a desktop browser.",
        ],
      },
      {
        heading: "Five ways to convert, ranked by privacy",
        paragraphs: [
          "The conversion itself is simple. The difference between methods is where the photo goes and how much control you have over quality and metadata.",
        ],
        table: {
          headers: ["Method", "Where the photo goes", "Quality control", "Best for"],
          rows: [
            ["iPhone Settings → Camera → Formats → Most Compatible", "Nowhere; future photos are captured as JPG", "Full camera quality", "Preventing the problem before it starts"],
            ["Share sheet → Save to Files / Mail", "Nowhere, but export options are limited", "Usually full quality", "A few photos on the phone"],
            ["Photos app on Mac → Export", "Nowhere", "Good; choose JPEG quality", "Mac users with a library"],
            ["Browser converter such as Cutmoor", "Stays in the browser tab", "Quality slider and preview", "Windows, Android, Chromebooks, cross-platform"],
            ["Upload-and-download website", "Uploaded to an unknown server", "Varies", "Avoid for personal photos"],
          ],
          caption:
            "A local converter is not automatically trustworthy. Check whether the page uploads the file or processes it in the browser.",
        },
      },
      {
        heading: "What happens to quality",
        paragraphs: [
          "Converting HEIC to JPG is a lossy-to-lossy transcode. The HEIC decoder reconstructs the pixels, then the JPG encoder compresses them again. A high-quality JPG (around 90) is visually clean for sharing and normal printing, but it is another generation of compression and the file will usually be larger than the HEIC original.",
          "HEIC also supports 10-bit colour and HDR. A standard JPG is 8-bit SDR, so very bright highlights and wide-gamut colour may look flatter after conversion. For casual photos this is rarely noticeable. For HDR video frames or professional colour work, keep the original and use a colour-managed editor.",
        ],
        bullets: [
          "Export at quality 90 for a clean share or print copy.",
          "Expect the JPG to be larger than the HEIC; that is the cost of compatibility.",
          "Avoid converting the same photo repeatedly; each pass adds loss.",
          "Keep the HEIC original if you may need HDR or the full metadata later.",
        ],
      },
      {
        heading: "Metadata, GPS, and orientation",
        paragraphs: [
          "HEIC files can carry EXIF metadata including GPS coordinates, camera model, lens, exposure, and capture time. A canvas-based conversion redraws the image and re-encodes it, so most of that metadata is not copied. That is usually good for privacy: sharing a photo of your home should not also share its coordinates.",
          "Orientation is handled differently. The decoder applies the stored rotation to the pixels, so the JPG appears upright even though the metadata is gone. This is the correct behaviour; a file that relied on an orientation tag and then lost the tag would appear sideways.",
          "If you need to preserve metadata for an archive, do not use a quick web converter. Use an editor or a command-line tool that copies EXIF deliberately, and check the result before deleting the original.",
        ],
      },
      {
        heading: "Troubleshooting a HEIC that will not convert",
        paragraphs: [
          "Most failures fall into a few categories. The file may not be HEIC at all, may contain more than one image, or may use a codec profile the decoder does not support.",
        ],
        bullets: [
          "Live Photos contain a still image and a short video. Export the still as a separate JPEG from Photos.",
          "Burst photos are a group of images; select the frame you want and export it individually.",
          "Some 10-bit HDR or ProRAW-adjacent files use profiles that a browser decoder may not handle.",
          "A file with a .heic extension can actually be AVIF or another ISO media format. Check the file header if a converter rejects it.",
          "If the browser runs out of memory, close other tabs and try one photo at a time.",
        ],
        callout:
          "On an iPhone, the most reliable fallback is Photos → Share → Copy Photo, then paste into an app that can export JPEG. It is slower, but it uses Apple's own decoder.",
      },
      {
        heading: "HEIC vs JPG vs PNG vs WebP",
        paragraphs: [
          "HEIC wins on size for Apple photos. JPG wins on compatibility. PNG wins on lossless graphics and transparency. WebP wins on web delivery when the destination supports it. None of them is the right answer for every file.",
        ],
        table: {
          headers: ["Format", "Typical strength", "Typical weakness", "Best destination"],
          rows: [
            ["HEIC", "Small files, good quality, HDR support", "Poor compatibility outside Apple", "iPhone photo library and archive"],
            ["JPG", "Opens everywhere, small enough", "Lossy, no transparency", "Email, upload forms, social platforms"],
            ["PNG", "Lossless, transparency", "Large photo files", "Screenshots, logos, diagrams"],
            ["WebP", "Small web files, transparency", "Older editors may reject it", "Websites and modern browsers"],
          ],
        },
      },
    ],
    faqs: [
      {
        question: "Is it safe to convert HEIC to JPG online?",
        answer:
          "Only if the converter processes the file in your browser. A traditional upload-and-download site sends the photo to a server you do not control. Cutmoor decodes HEIC locally with the system decoder on Safari or a lazily loaded open-source decoder on other browsers, so the photo never leaves the device.",
      },
      {
        question: "Does converting HEIC to JPG reduce quality?",
        answer:
          "A little. HEIC is more efficient, so a high-quality JPG is usually larger and may lose some fine detail or HDR range. Exporting at quality 90 keeps the result clean for sharing and normal printing.",
      },
      {
        question: "Can I stop my iPhone from taking HEIC photos?",
        answer:
          "Yes. Open Settings → Camera → Formats and choose Most Compatible. New photos will be captured as JPG. Existing HEIC photos are not converted retroactively, so you still need to convert the ones you already have.",
      },
      {
        question: "Why does the converter fail on my HEIC file?",
        answer:
          "The file may be a Live Photo, a burst, a 10-bit HDR variant, or a HEIC container with a codec profile the decoder does not support. Try exporting the still from the iPhone Photos app first, then convert that copy.",
      },
      {
        question: "Does the JPG keep the GPS location?",
        answer:
          "No. A canvas-based conversion strips EXIF and GPS metadata and applies orientation to the pixels. That is usually desirable for privacy, but it also removes camera and copyright fields. Keep the original HEIC if you need the full metadata.",
      },
      {
        question: "Why is the JPG larger than the HEIC file?",
        answer:
          "HEIC compresses more efficiently than JPG. Converting for compatibility usually increases the file size even at high quality. If size is the priority and the destination accepts it, keep the HEIC or convert to WebP instead.",
      },
    ],
  },
];
