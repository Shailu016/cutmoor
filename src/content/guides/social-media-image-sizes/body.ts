import type { GuideBody } from "../../types";

export const body: GuideBody = {
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
};
