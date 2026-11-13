import type { GuideBody } from "../../types";

export const body: GuideBody = {
  sections: [
    {
      heading: "What a 9:16 crop actually costs",
      paragraphs: [
        "Nine-by-sixteen means 16 units of height for every 9 units of width. On a 1080-pixel-wide canvas that is 1920 pixels tall. A standard 16:9 source is the opposite shape, so filling a vertical frame means throwing away the sides.",
        "Do the math once and the tradeoff is obvious. From a 1920x1080 source, a full-height 9:16 crop is 607 pixels wide. You keep about 32 percent of the frame, then stretch those 607 pixels to 1080, an upscale of 1.8x. From a 4K source, the crop is 1215x2160, which downscales to 1080x1920 and stays sharp. If you shoot horizontal and plan to crop, shoot 4K.",
      ],
      table: {
        headers: ["Source", "9:16 crop", "Result after scaling"],
        rows: [
          ["1920 x 1080", "607 x 1080", "Upscaled 1.8x, visibly soft"],
          ["2560 x 1440", "810 x 1440", "Upscaled 1.3x, acceptable"],
          ["3840 x 2160", "1215 x 2160", "Downscaled, sharp"],
        ],
      },
    },
    {
      heading: "Center crop vs letterbox vs blur pad",
      paragraphs: [
        "Center crop is the default because it is predictable: it keeps the middle and removes equal amounts from each side. For a single speaker or a centered product, it works. For two people side by side, it cuts one out.",
        "Letterboxing keeps the whole frame but shrinks the video to a strip in the middle. On a phone that strip is small, and viewers notice. Blur padding fills the empty space with a blurred copy of the video. It looks more polished than black bars for casual reposts, but it adds visual noise and encoding cost.",
        "Manual reframing is the honest answer for action and interviews. Keyframe the crop so it follows the subject.",
      ],
      table: {
        headers: ["Approach", "What it does", "Best for", "Cost"],
        rows: [
          ["Center crop", "Fills the frame, cuts both sides", "One centered subject", "Loses the sides"],
          ["Letterbox", "Whole frame, black bars", "Tutorials with edge text", "Small video area"],
          ["Blur pad", "Whole frame over blurred fill", "Casual reposts", "Busy, soft edges"],
          ["Keyframed crop", "Crop follows the subject", "Action, interviews", "Editing time"],
        ],
      },
    },
    {
      heading: "Keep text inside the safe zone",
      paragraphs: [
        "Every vertical platform draws controls over the video. The exact pixel counts change with app versions and device sizes, so treat these as design margins rather than hard laws.",
      ],
      table: {
        headers: ["Platform", "Clear top", "Clear bottom", "Right margin"],
        rows: [
          ["TikTok", "About 150 px", "About 320 px", "About 120 px"],
          ["Reels", "About 250 px", "About 400 px", "About 120 px"],
          ["Shorts", "About 150 px", "About 300 px", "About 120 px"],
        ],
        caption:
          "Approximate values for a 1080x1920 frame. Check the current app before a paid campaign.",
      },
      callout:
        "The bottom band is the one people forget. Captions, handles, and the audio ticker all live there.",
    },
    {
      heading: "The filter, explained in plain English",
      paragraphs: [
        "An ffmpeg crop filter looks like this: crop=ih*9/16:ih. Read it as width:height. The height stays the input height, written ih. The width is that height multiplied by 9/16, which forces the 9:16 shape. The x and y offsets are omitted, so the crop is centered.",
        "Order matters. Crop first, then scale: crop=ih*9/16:ih,scale=1080:1920. If you scale first and crop second, you resample the whole frame and then throw most of it away. Add setsar=1 so the pixel aspect ratio is square and the platforms do not stretch the result.",
        "For letterboxing, the chain goes the other way. Scale to fit the width, then pad the shortfall with black: scale=1080:-2,pad=1080:1920:0:(oh-ih)/2. The -2 keeps the height even, which H.264 requires.",
      ],
    },
    {
      heading: "Step by step",
      paragraphs: [
        "The goal is one clean vertical export, not a stack of test files. Preview before you encode.",
      ],
      bullets: [
        "1. Find the subject in the source and decide whether the center crop keeps it.",
        "2. If two subjects matter, reframe manually with keyframes instead of guessing.",
        "3. Leave headroom above faces. Vertical frames feel cramped when the forehead touches the top edge.",
        "4. Check the safe zones before you export. Move captions and logos into the clear area.",
        "5. Scale to 1080x1920 and set a square pixel aspect ratio.",
        "6. Export H.264 at 8 to 10 Mbps, 30 fps, with AAC audio.",
        "7. Watch the result on a phone in the actual app, not just in a desktop player.",
      ],
    },
    {
      heading: "Platform differences",
      paragraphs: [
        "TikTok, Reels, and Shorts all want 9:16 and 1080x1920, but they do not treat the frame the same. TikTok's interface is the most intrusive at the bottom and right. Reels puts the caption and audio name across the lower third. Shorts keeps the bottom cleaner but overlays the title and channel name at the top.",
        "Duration caps differ too. Reels and Shorts top out at 3 minutes, while TikTok accepts much longer uploads. A single 9:16 export is reusable across all three, but re-check caption placement and the first frame, since each app chooses its own thumbnail. Cutmoor can crop and export the vertical file locally, so you can compare the framing in each app before posting.",
      ],
    },
  ],
  faqs: [
    {
      question: "Can I crop a video to 9:16 without losing quality?",
      answer:
        "Only if the source has pixels to spare. Cropping and scaling always resamples the image. A 4K horizontal source gives you a sharp 1080x1920 result; a 1080p source does not.",
    },
    {
      question: "Should I letterbox instead of cropping?",
      answer:
        "Letterbox when the full frame carries information, such as a tutorial with text near both edges. Otherwise the small video area costs more attention than the cropped sides.",
    },
    {
      question: "Does cropping change the duration or audio?",
      answer:
        "No. A crop only changes the visible frame. Duration, frame rate, and audio stay the same unless you change them separately.",
    },
    {
      question: "What about 4:5 or 1:1?",
      answer:
        "Those shapes work for feed posts and carousels. For Reels, Shorts, and TikTok, use 9:16 so the video fills the screen instead of being padded.",
    },
    {
      question: "Can I crop a video on my phone?",
      answer:
        "Yes. Most phones have a basic crop in the editor, and browser tools can do the same without installing an app. Check the result in the target app before publishing.",
    },
  ],
};
