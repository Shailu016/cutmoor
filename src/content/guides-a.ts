import type { Guide } from "./types";

/** Guides 1–5. Written in parallel with the app build. */
export const GUIDES_A: Guide[] = [
  {
    slug: "compress-video-for-whatsapp",
    title: "How to compress a video for WhatsApp (without ruining it)",
    description:
      "WhatsApp re-encodes every video you send through the chat picker. How to hit its size limits, keep the picture sharp, and know when to send as a document.",
    excerpt:
      "WhatsApp's chat limit is roughly 16 MB, and it re-encodes whatever you send. Pick the right target bitrate, export once, and your video survives the trip.",
    category: "Compression",
    published: "2026-11-11",
    modified: "2026-11-11",
    readingMinutes: 6,
    tools: ["compress", "resize"],
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
  },
  {
    slug: "compress-video-for-discord",
    title: "How to compress a video for Discord",
    description:
      "Discord's free upload cap is 10 MB per file. Here is the bitrate math, the resolution ladder, and the settings that keep a clip clean at that size.",
    excerpt:
      "Ten megabytes is not much video. Do the bitrate math first, then choose a resolution and frame rate that fit instead of shrinking the file and hoping.",
    category: "Compression",
    published: "2026-11-11",
    modified: "2026-11-11",
    readingMinutes: 6,
    tools: ["compress"],
    sections: [
      {
        heading: "The limits, including the ones people still quote",
        paragraphs: [
          "Discord's free plan allows 10 MB per file. That is the number to design around. Paid tiers raise the cap, and server boosts raise it for everyone in that server. A file that failed in one channel may upload fine in another.",
          "Old guides still cite 8 MB because that was the free limit for years. The 25 MB tier also persists in screenshots from earlier Nitro plans.",
        ],
        table: {
          headers: ["Plan or context", "Per-file cap", "Notes"],
          rows: [
            ["Free tier before 2023", "8 MB", "The classic limit in older guides"],
            ["Free tier today", "10 MB", "The default most uploads hit"],
            ["Legacy 25 MB tier", "25 MB", "Older Nitro and promotional plans"],
            ["Nitro Basic", "50 MB", "Current Basic cap in most regions"],
            ["Full Nitro", "500 MB", "Varies by plan and region"],
            ["Boosted server, Level 2", "50 MB", "Applies to every member"],
            ["Boosted server, Level 3", "100 MB", "Applies to every member"],
          ],
          caption:
            "Caps change with plan and region. The 10 MB free limit is the one that shapes most clips.",
        },
      },
      {
        heading: "Turn 10 MB into a bitrate",
        paragraphs: [
          "Ten megabytes is 80 megabits. Divide by the length of the clip and you have the total bitrate budget, audio included. A 60-second clip gets about 1.3 Mbps. A 30-second clip gets 2.6 Mbps. That explains why long clips look bad at this size: there is no bitrate left.",
          "Leave 5 to 10 percent of headroom. Discord measures the actual file, and container overhead plus a thumbnail can push a 9.9 MB export over the line.",
        ],
        table: {
          headers: ["Length", "Total budget", "Video after 96 kbps audio", "Sensible resolution"],
          rows: [
            ["15 seconds", "5.3 Mbps", "5.2 Mbps", "1080p"],
            ["30 seconds", "2.7 Mbps", "2.6 Mbps", "1080p or 720p"],
            ["60 seconds", "1.3 Mbps", "1.2 Mbps", "720p"],
            ["120 seconds", "670 kbps", "570 kbps", "540p"],
            ["300 seconds", "270 kbps", "170 kbps", "360p, or split the clip"],
          ],
          caption: "Assumes a 10 MB ceiling and a little room for overhead.",
        },
      },
      {
        heading: "Quality tradeoffs that actually help",
        paragraphs: [
          "At a fixed file size, every setting takes bits from somewhere else. Spend them where viewers notice.",
        ],
        bullets: [
          "Resolution beats bitrate for screen recordings and talking heads. 720p at 1.2 Mbps usually looks cleaner than 1080p at the same bitrate because fewer pixels compete for the same bits.",
          "Drop to 30 fps. Gameplay and screen captures often arrive at 60. Halving the frame rate frees roughly half the bitrate for detail.",
          "Use CRF 24 to 28 for a one-pass export. At 10 MB, CRF 26 is usually the sweet spot for 720p.",
          "Keep voice audio mono at 64 to 96 kbps. Stereo music needs 128 kbps, but that comes out of the same budget.",
          "Crop before you scale. Black bars are pixels you pay to encode for no information.",
        ],
        callout:
          "A two-minute clip at 10 MB is a 570 kbps video, which is 360p territory. Split it into two parts or post a link instead of forcing it.",
      },
      {
        heading: "Step by step",
        paragraphs: [
          "The order matters less than doing the trim before the encode. Ten seconds of setup can be 10 percent of a short clip's entire budget.",
        ],
        bullets: [
          "1. Trim to the part people will watch.",
          "2. Crop to the content. Remove letterboxing and dead space around a screen capture.",
          "3. Pick the resolution from the table. Do not upscale.",
          "4. Encode as H.264 MP4 at 30 fps, using CRF 26 or the bitrate from the table.",
          "5. Set audio to AAC mono at 96 kbps.",
          "6. Export and check the size in Explorer or Finder. If it is over 9.5 MB, drop one resolution step and export again.",
          "7. Upload. In a busy server, a link is often kinder than an autoplaying preview.",
        ],
      },
      {
        heading: "When 10 MB is the wrong fight",
        paragraphs: [
          "Some clips do not belong in a 10 MB attachment. A five-minute gameplay capture, a software demo with small text, or anything with heavy motion will look bad no matter how you set the encoder. Upload to a video host and paste the link. Discord embeds the player and the file limit stops applying. For a clip that must stay a file, split it at a scene change and send two parts.",
          "Nitro is the other option. The jump from 10 MB to 50 MB matters most; past that, hosting is usually the better workflow.",
        ],
      },
      {
        heading: "Common mistakes",
        paragraphs: [
          "A few habits waste the entire budget before the encoder starts.",
        ],
        bullets: [
          "Compressing an already compressed download. Start from the original whenever possible.",
          "Using HEVC for a smaller file, then wondering why previews stutter on someone else's machine.",
          "Sending a camera MOV with ProRes inside. The codec eats the budget before the video does.",
          "Trusting the size shown in the editor instead of the exported file.",
          "Renaming a failed file and uploading it again. The bytes did not change.",
          "Forgetting that Discord transcodes previews separately. The file can be fine while the inline player still looks soft.",
        ],
      },
    ],
    faqs: [
      {
        question: "Why did my 9 MB video fail to upload?",
        answer:
          "File managers and editors sometimes report mebibytes as megabytes, and container overhead adds a little more. Check the exact byte count and aim for 9.5 MB or less against a 10 MB cap.",
      },
      {
        question: "Does Discord compress uploaded videos?",
        answer:
          "Uploaded files are stored as files. The inline preview is transcoded for playback, so the download can look better than the player. Nitro members also get higher-quality streaming.",
      },
      {
        question: "Is the 25 MB limit still available?",
        answer:
          "It survives on some legacy plans and promotions, but current entry-level paid plans usually advertise 50 MB. Your account settings show what applies to you.",
      },
      {
        question: "What format works best for Discord?",
        answer:
          "MP4 with H.264 video and AAC audio. WebM is supported, but H.264 MP4 is the least likely to fail on an unfamiliar device.",
      },
      {
        question: "How can I send a 50 MB clip without paying?",
        answer:
          "Post it in a server with Level 2 boosts, split it into smaller parts, or upload it elsewhere and share the link. The last option keeps the quality intact.",
      },
    ],
  },
  {
    slug: "compress-video-for-instagram-reels",
    title: "How to compress a video for Instagram Reels",
    description:
      "Reels want 1080x1920, clean motion, and a bitrate that survives Instagram's re-encode. Here is how to export a master that still looks sharp after upload.",
    excerpt:
      "Instagram re-encodes every Reel. Export a clean 1080x1920 master at the right bitrate, keep captions out of the interface, and the second encode has less to ruin.",
    category: "Compression",
    published: "2026-11-11",
    modified: "2026-11-11",
    readingMinutes: 6,
    tools: ["resize", "compress"],
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
  },
  {
    slug: "crop-video-to-9-16",
    title: "How to crop a video to 9:16 for Reels, Shorts, and TikTok",
    description:
      "A 9:16 crop is more than a resize. How to reframe horizontal footage, where platform interfaces cover your video, and what the crop filter really does.",
    excerpt:
      "Filling a vertical frame means cutting the sides. Learn the cost of the crop, when to letterbox instead, and how to keep captions out from under the interface.",
    category: "Editing",
    published: "2026-11-11",
    modified: "2026-11-11",
    readingMinutes: 7,
    tools: ["resize", "compress"],
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
  },
  {
    slug: "convert-mov-to-mp4",
    title: "How to convert MOV to MP4 (free, in your browser)",
    description:
      "MOV is Apple's container; MP4 is the one everything else plays. What changes during conversion, when H.264 beats HEVC, and how to avoid the common traps.",
    excerpt:
      "A MOV file is a box, not a codec. Learn what is inside, why MP4 travels better, and which settings keep the picture intact without a giant file.",
    category: "Conversion",
    published: "2026-11-11",
    modified: "2026-11-11",
    readingMinutes: 6,
    tools: ["convert", "compress"],
    sections: [
      {
        heading: "What MOV actually is",
        paragraphs: [
          "MOV is a container format Apple introduced with QuickTime in 1991. The name describes the box, not the video inside it. A MOV file can hold H.264, HEVC, ProRes, or uncompressed video, plus several audio tracks, timecode, chapter markers, and an alpha channel. That flexibility is why iPhones and Macs default to it.",
          "An iPhone recording is usually HEVC or H.264 in a MOV container. A camera rig may write ProRes, which is huge but easy to edit. Neither is visible from the extension, so two clip.mov files can behave differently.",
        ],
      },
      {
        heading: "When MP4 is the better choice",
        paragraphs: [
          "MP4 is also a container, but it is the one the rest of the world expects. Windows, Android, smart TVs, browsers, and social platforms all handle MP4 with H.264 and AAC without extra codecs.",
        ],
        bullets: [
          "Playback: no codec pack, no unsupported-format message.",
          "Web: faststart lets the video begin before the whole file downloads.",
          "Sharing: messaging apps and social platforms accept MP4 everywhere.",
          "Size: H.264 MP4 is a fraction of a ProRes MOV for the same footage.",
          "Handoff: MP4 is safer when the other person is on a different platform.",
        ],
        table: {
          headers: ["Property", "MOV", "MP4"],
          rows: [
            ["Origin", "Apple QuickTime", "ISO media standard"],
            ["Common codecs", "ProRes, HEVC, H.264", "H.264, HEVC, AV1"],
            ["Platform support", "Best on Apple devices", "Broad on phones, TVs, browsers"],
            ["Alpha channel", "Supported with some codecs", "Not with H.264"],
            ["Streaming", "Possible", "Faststart is standard"],
          ],
        },
      },
      {
        heading: "H.264 vs HEVC",
        paragraphs: [
          "H.264 is the safe default. It plays on almost everything made in the last 15 years, encodes quickly, and has universal hardware support. HEVC, also called H.265, delivers similar quality at a lower bitrate, often 25 to 50 percent lower, but support is patchier. Older Windows machines may need a codec pack, some Android devices lack hardware decoding, and browser support varies.",
          "Use H.264 for files you share. Keep HEVC for your own archive only when you know the playback device handles it. Do not pick it just because the number is smaller.",
        ],
        table: {
          headers: ["Codec", "Compatibility", "Efficiency", "Use it for"],
          rows: [
            ["H.264", "Excellent", "Good", "Sharing, web, editing handoffs"],
            ["HEVC", "Mixed on older devices", "25 to 50 percent smaller", "Personal archives, newer Apple gear"],
            ["ProRes", "Apple and pro editors", "Very large files", "Editing, not delivery"],
          ],
        },
      },
      {
        heading: "Settings that keep the quality",
        paragraphs: [
          "Conversion means a stream copy, which keeps the codec and is lossless, or a decode and re-encode. A stream copy only works when the target supports the codec, so most MOV to MP4 jobs need a real encode.",
        ],
        bullets: [
          "CRF 18 to 23 for H.264. Lower is better. 18 is close to visually lossless for most footage, and 23 is a sensible delivery default.",
          "Preset medium or slow. Slower presets buy efficiency, not quality, and they take longer.",
          "Profile High, level 4.1 for 1080p and 5.1 for 4K.",
          "Keep the source resolution and frame rate. Do not upscale.",
          "Audio AAC at 192 kbps, 48 kHz. Decide whether a surround source should be downmixed to stereo.",
          "Enable faststart when the file will be streamed.",
          "Tone map HDR to SDR, or colors will look washed out on non-HDR displays.",
        ],
        callout:
          "Renaming .mov to .mp4 does not convert anything. The container and codec stay the same, and players that failed before will keep failing.",
      },
      {
        heading: "Step by step",
        paragraphs: [
          "Check the source before choosing settings. A ProRes master and an iPhone clip need different treatment even though both are MOV files.",
        ],
        bullets: [
          "1. Inspect the file. Note the codec, resolution, frame rate, audio channels, and whether it is HDR.",
          "2. Choose MP4 with H.264 unless you have a specific reason to keep HEVC.",
          "3. Set CRF 20 and preset medium for a good balance of size and quality.",
          "4. Match the audio to the source. Do not turn mono into stereo for no reason.",
          "5. Export, then play the result in a different player than the one you used to convert.",
          "6. Check duration, audio sync, and rotation before you delete the original.",
          "7. Keep the MOV until the MP4 is verified. Cutmoor converts in the browser, so the file stays on your machine.",
        ],
      },
      {
        heading: "Conversion pitfalls",
        paragraphs: [
          "Most failed conversions are mismatched expectations about what a container can hold.",
        ],
        bullets: [
          "Expecting a ProRes file to shrink with no visible change. H.264 at CRF 20 is far smaller, but not identical.",
          "Losing alpha. H.264 in MP4 does not carry transparency. Use ProRes 4444 or a WebM codec that supports alpha.",
          "Washed-out HDR. Naive tone mapping clips highlights or shifts skin tones. Check a frame before exporting.",
          "Variable frame rate. Phone recordings often use VFR. Some encoders assume constant and let audio drift. Force a constant rate when the tool allows it.",
          "Dropped rotation metadata. A portrait iPhone clip may be stored landscape with a flag. Some converters ignore it, and the video arrives sideways.",
          "Multiple audio tracks. MP4 can hold several, but many players pick the first. Choose the right one during export.",
        ],
      },
    ],
    faqs: [
      {
        question: "Is MOV higher quality than MP4?",
        answer:
          "No. The container does not set quality. Codec, bitrate, and resolution do. A ProRes MOV can be excellent, and an H.264 MP4 can match it visually at a much smaller size.",
      },
      {
        question: "Will converting MOV to MP4 lose quality?",
        answer:
          "A re-encode is lossy, but at CRF 18 to 20 the difference is hard to see. If the MOV already contains H.264 or HEVC, a stream copy can change the container without re-encoding at all.",
      },
      {
        question: "Can I convert MOV to MP4 on an iPhone?",
        answer:
          "Yes, but Photos may hand you another MOV. A browser-based converter avoids installing an app and keeps the file local.",
      },
      {
        question: "Why is my MP4 larger than the MOV?",
        answer:
          "Different codecs or settings. ProRes is an editing format with a huge bitrate; H.264 is built for delivery. A bigger MP4 usually means a higher quality or less efficient preset.",
      },
      {
        question: "Does MP4 support 4K and HEVC?",
        answer:
          "Yes. MP4 can hold 4K H.264, 4K HEVC, and AV1. The container is not the limit; the player and device are.",
      },
    ],
  },
];
