import type { GuideBody } from "../../types";

export const body: GuideBody = {
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
};
