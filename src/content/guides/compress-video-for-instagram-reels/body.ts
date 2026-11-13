import type { GuideBody } from "../../types";

export const body: GuideBody = {
  sections: [
    {
      heading: "The specs that matter",
      paragraphs: [
        "Reels are vertical, full-screen, and short. The platform accepts other shapes and then pads or crops them, which rarely looks intentional. Start with the right canvas and the rest of the settings are easier to reason about.",
      ],
      table: {
        headers: ["Spec", "Target"],
        rows: [
          ["Aspect ratio", "9:16"],
          ["Resolution", "1080 x 1920"],
          ["Duration", "Up to 3 minutes on current builds"],
          ["Frame rate", "30 fps, or 60 for fast motion"],
          ["Video codec", "H.264, High profile"],
          ["Video bitrate", "8 to 12 Mbps"],
          ["Audio", "AAC, 192 kbps, 48 kHz"],
          ["File size", "50 to 100 MB for a 60-second Reel"],
          ["Container", "MP4"],
        ],
        caption:
          "Instagram accepts MOV and other formats, but MP4 with H.264 is the least surprising choice.",
      },
    },
    {
      heading: "Why bitrate decides how it looks after upload",
      paragraphs: [
        "Every upload gets re-encoded. Instagram decodes your file, fits it into its delivery ladder, and encodes again at bitrates tuned for mobile playback. A master that is already soft, blocky, or noisy gives that second encoder bad input. The artifacts get worse, especially in shadows, gradients, and fast camera moves.",
        "File size is a poor proxy for quality. A 100 MB export of a static talking head is mostly wasted bits. A 20 MB export of a confetti explosion is starved. Bits per pixel is the useful measure. At 1080x1920 and 30 fps, 8 Mbps is a comfortable floor for detailed footage.",
      ],
    },
    {
      heading: "Build the master",
      paragraphs: [
        "Shoot vertical when you can. Cropping a horizontal frame to 9:16 throws away about two-thirds of the width, and upscaling the remaining strip makes it softer before Instagram touches it.",
      ],
      bullets: [
        "Export at 1080x1920. A 4K file will be downscaled, and upscaling a 720p source adds nothing.",
        "Use H.264 High profile, level 4.2, at 30 fps, with a keyframe every one to two seconds.",
        "Rate control: CRF 20 to 23, or 8 to 10 Mbps variable bitrate with a two-pass encode.",
        "Audio: AAC at 192 kbps, 48 kHz stereo. Normalize to about -14 LUFS integrated with peaks below -1 dBTP.",
        "Keep the first frame clean. It is often used as the thumbnail, and a blurry opening frame costs you the scroll.",
      ],
    },
    {
      heading: "Framing and safe zones",
      paragraphs: [
        "Reels are full-screen, and the interface sits on top of your video. On a 1080x1920 canvas, the top 250 pixels hold the status area and the Reels label, while the bottom 350 to 400 pixels hold the caption, audio name, and action buttons. The right edge carries more buttons near the bottom. Text placed there is invisible in practice.",
      ],
      bullets: [
        "Keep captions between roughly y=300 and y=1450 on a 1080x1920 frame.",
        "Keep faces, logos, and prices out of the bottom-right corner.",
        "Leave at least 60 pixels of margin on each side.",
        "If you reuse a TikTok or Shorts edit, check caption placement again. The interfaces differ.",
      ],
      callout:
        "A caption pinned to the very bottom of the frame is a caption nobody reads. Move it up before you export, not after.",
    },
    {
      heading: "Step by step",
      paragraphs: [
        "A clean master takes one export, not five. Do the reframing and audio work before the encode.",
      ],
      bullets: [
        "1. Start from the highest-quality source you have, ideally the original camera file.",
        "2. Trim to the strongest few seconds. Reels reward completion, and a slow intro loses viewers.",
        "3. Crop or reframe to 9:16. Keep the subject in the middle third.",
        "4. Scale to 1080x1920 and confirm the pixel aspect ratio is square.",
        "5. Encode H.264 at CRF 20 to 23, or 8 to 10 Mbps, with AAC audio at 192 kbps.",
        "6. Normalize the audio and listen on a phone speaker, not headphones.",
        "7. Watch the exported file once on a phone before uploading. Check captions, edges, and the first frame.",
      ],
    },
    {
      heading: "Quality and reach",
      paragraphs: [
        "Instagram does not publish a formula that maps bitrate to reach, and anyone who claims otherwise is guessing. What the platform does say is that Reels are ranked on signals such as watch time and completion. A blurry, stuttering video loses viewers in the first second, and that shows up in those signals. Clean motion and readable captions are worth more than a marginally higher resolution.",
        "Upload once, from the master. Downloading a Reel and re-uploading it stacks another generation of compression, and the drop is visible. Cutmoor can do the trim, crop, and encode in the browser without sending the file anywhere.",
      ],
    },
  ],
  faqs: [
    {
      question: "Does Instagram compress Reels?",
      answer:
        "Yes. Every upload is re-encoded for delivery. A high-quality master survives that pass better, but no export setting prevents it.",
    },
    {
      question: "What is the best file size for a Reel?",
      answer:
        "Aim for 50 to 100 MB per minute of 1080x1920 footage. Bitrate matters more than the total: 8 to 12 Mbps is a practical range for detailed video.",
    },
    {
      question: "Can I upload a 4K vertical video?",
      answer:
        "Yes, but Instagram will downscale it. Exporting at 1080x1920 avoids a wasted upload and gives you more control over the final sharpness.",
    },
    {
      question: "Should I use 60 fps for Reels?",
      answer:
        "Only for fast motion such as sports or gameplay. At 30 fps you get more bits per frame at the same file size, which usually looks better for talking-head and product clips.",
    },
    {
      question: "Why is my Reel blurry after upload?",
      answer:
        "Common causes are a low-bitrate master, a horizontal clip cropped and upscaled, heavy denoising, or re-uploading a file that was already downloaded from the platform.",
    },
  ],
};
