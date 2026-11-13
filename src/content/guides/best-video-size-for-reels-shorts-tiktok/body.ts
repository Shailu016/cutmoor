import type { GuideBody } from "../../types";

export const body: GuideBody = {
  sections: [
    {
      heading: "Why 1080x1920 is the baseline",
      paragraphs: [
        "All three short-form platforms are built around a vertical 9:16 frame. At 1080x1920 that is 2.07 million pixels, a standard phone resolution, and a file size that uploads comfortably on mobile data. It is also the resolution most phones can shoot and edit without overheating.",
        "Shooting or exporting at 2160x3840 quadruples the pixel count. The platform will re-encode the upload anyway, often to 1080p or lower, so the extra detail rarely survives. A clean 1080x1920 file at a healthy bitrate beats a noisy 4K file at the same bitrate.",
        "If your source is horizontal, do not stretch it. Crop to 9:16 and reframe, or place it on a designed background. Stretched faces are the fastest way to look amateur.",
      ],
    },
    {
      heading: "Platform numbers for 2026",
      paragraphs: [
        "The duration column matters more than the resolution column. A three-minute Reel and a three-minute Short are different products from a 60-minute TikTok web upload, even though all three can be 1080x1920.",
      ],
      table: {
        headers: ["Platform", "Aspect", "Resolution", "Duration", "Working file size"],
        rows: [
          [
            "Instagram Reels",
            "9:16",
            "1080x1920",
            "Up to 3 minutes",
            "8-12 Mbps, about 60-90 MB per minute",
          ],
          [
            "TikTok",
            "9:16",
            "1080x1920",
            "Up to 10 minutes in app, 60 minutes on web",
            "8-12 Mbps, keep under 500 MB",
          ],
          [
            "YouTube Shorts",
            "9:16",
            "1080x1920",
            "Up to 3 minutes",
            "10-12 Mbps, under 2 GB",
          ],
          [
            "Facebook Reels",
            "9:16",
            "1080x1920",
            "Up to 90 seconds",
            "8-10 Mbps, under 1 GB",
          ],
        ],
        caption:
          "Limits change. Check the current upload help page before a campaign. The working sizes are practical targets, not platform guarantees.",
      },
    },
    {
      heading: "Bitrate and file size math",
      paragraphs: [
        "File size is bitrate multiplied by duration, divided by eight. At 10 Mbps, one second is 1.25 MB, so one minute is 75 MB and three minutes is 225 MB. That fits comfortably within mobile upload limits and still looks sharp after the platform's re-encode.",
        "Use H.264 High profile for compatibility, AAC audio at 128-192 kbps, and a 48 kHz sample rate. Keep the frame rate at 30 fps for talking heads and 60 fps for gameplay or fast motion. Do not mix frame rates in one timeline; convert before export.",
        "A lower bitrate is not automatically safer. Platforms compress again, and a starved upload develops blocky gradients and smeared motion that no server-side encode can fix.",
      ],
    },
    {
      heading: "Safe zones and captions",
      paragraphs: [
        "Every platform overlays buttons and text on the video. The exact layout changes, but the pattern is stable: a strip at the top for the header, a larger block at the bottom for the caption, username, and actions, and a column on the right for like, comment, and share.",
        "A practical safe zone for 1080x1920 is the central 1080x1420 area, keeping critical text at least 150-220 px from the top and 380-450 px from the bottom. Keep faces and logos out of the right 120 px if the interface overlaps them.",
      ],
      bullets: [
        "Put the hook in the upper-middle, not at the very top.",
        "Keep burned-in captions above the bottom 420 px.",
        "Leave the lower-right corner clear of logos and calls to action.",
        "Preview the export inside the app, not just in your editor.",
      ],
    },
    {
      heading: "Export settings that survive re-compression",
      paragraphs: [
        "Export from the highest-quality source you have. Do not export from a file that has already been through three apps. Each trip through a lossy encoder adds artifacts, and vertical video magnifies them because the frame is scaled up on a phone screen.",
      ],
      bullets: [
        "Container: MP4.",
        "Video: H.264, 1080x1920, 30 or 60 fps, 8-12 Mbps.",
        "Audio: AAC, 128-192 kbps, 48 kHz, stereo.",
        "Color: Rec. 709, full range off, standard gamma.",
        "Fast start enabled so playback begins before the full file downloads.",
        "Captions: burned in for social, or a separate VTT for a web player.",
      ],
    },
    {
      heading: "Common mistakes",
      paragraphs: [
        "These are the settings and habits that most often make a vertical video look worse than it needs to.",
      ],
      bullets: [
        "Uploading 4K because higher is better. It is not, once the platform re-encodes.",
        "Letterboxing horizontal footage with huge black bars.",
        "Putting captions in the bottom 300 px where the interface covers them.",
        "Using a 24 fps cinematic export for fast motion, then wondering why it stutters.",
        "Stretching a 16:9 clip instead of cropping or reframing.",
        "Exporting at 3 Mbps to save space and losing the gradient sky.",
      ],
    },
  ],
  faqs: [
    {
      question: "Is 4K better for Reels or TikTok?",
      answer:
        "Usually no. The platforms re-encode uploads, and most viewers watch on a 1080p phone screen. A clean 1080x1920 file at 8-12 Mbps is the better trade.",
    },
    {
      question: "Can I use the same file for all three platforms?",
      answer:
        "Yes, if it fits the shortest duration limit and keeps text inside the strictest safe zone. Facebook Reels at 90 seconds is often the binding constraint.",
    },
    {
      question: "What frame rate should I use?",
      answer:
        "30 fps for talking heads and static shots, 60 fps for gameplay, sports, or fast camera moves. Keep it consistent for the whole clip.",
    },
    {
      question: "Why does my video look soft after upload?",
      answer:
        "The platform re-encoded it, and the source bitrate was probably low. Export at 8-12 Mbps and avoid upscaling from 720p.",
    },
    {
      question: "Should captions be burned in or uploaded separately?",
      answer:
        "Burn them in for Reels, Shorts, and TikTok because viewer-side caption support varies. Use a separate VTT when the video plays in your own web player.",
    },
  ],
};
