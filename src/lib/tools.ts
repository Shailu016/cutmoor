export interface ToolFaq {
  question: string;
  answer: string;
}

export interface ToolDef {
  slug: string;
  kind: "video" | "image";
  name: string;
  short: string;
  title: string;
  description: string;
  intro: string;
  icon:
    | "compress"
    | "crop"
    | "trim"
    | "convert"
    | "audio"
    | "frame"
    | "captions"
    | "image-compress"
    | "image-resize"
    | "image-convert"
    | "heic";
  accent: string;
  keywords: string[];
  steps: { name: string; text: string }[];
  faqs: ToolFaq[];
  related: string[];
}

export const TOOLS: ToolDef[] = [
  {
    slug: "compress",
    kind: "video",
    name: "Compress video",
    short: "Hit a target file size without wrecking the picture.",
    title: "Compress a video online — in your browser, no upload",
    description:
      "Compress MP4, MOV, and WebM videos to a target size for WhatsApp, Discord, Instagram, or email. Runs locally in your browser, so the file never leaves your device.",
    intro:
      "Pick a target size and ClipKit calculates a video bitrate that fits. The file is decoded and re-encoded on your device, not on a server. Use it when an app rejects a video for being too large, or when a 4K clip is 400 MB and you only need a clean 1080p share.",
    icon: "compress",
    accent: "lime",
    keywords: ["compress video", "video compressor", "reduce video size", "video under 25mb"],
    steps: [
      { name: "Choose the video", text: "Drop an MP4, MOV, WebM, or MKV file. Metadata is read locally to calculate the right bitrate." },
      { name: "Pick a target", text: "Select a preset such as 25 MB for Instagram or 10 MB for Discord, or choose a quality-first CRF encode." },
      { name: "Compress and download", text: "The browser encoder produces a new MP4. Nothing is uploaded while it runs." },
    ],
    faqs: [
      {
        question: "Will compression make my video blurry?",
        answer:
          "Some quality loss is unavoidable when the file gets smaller. ClipKit keeps the original resolution unless you lower it, and it reserves 128 kbps for audio so dialogue stays clear. For a mild reduction, use the Balanced preset instead of an aggressive target size.",
      },
      {
        question: "What is the best target size for WhatsApp?",
        answer:
          "WhatsApp compresses videos again when you send them as media, so aim below the app limit and keep the resolution at 720p or 1080p. If you need the exact file, send it as a document instead of a video.",
      },
      {
        question: "Does ClipKit upload my video?",
        answer:
          "No. The encoder is WebAssembly running inside the page. The file is read from your disk, processed in memory, and saved back to your device. You can disconnect from the internet after the page loads and the tool still works.",
      },
      {
        question: "How large a file can it handle?",
        answer:
          "Browser memory is the limit, not an upload quota. Files up to roughly 500 MB work on a desktop with 8 GB of RAM. Phones and older laptops should stay under 200 MB. Very large files can run out of memory in the tab.",
      },
    ],
    related: ["resize", "trim", "convert"],
  },
  {
    slug: "resize",
    kind: "video",
    name: "Crop & resize",
    short: "Make a clean 9:16, 1:1, or 4:5 cut for any feed.",
    title: "Crop a video to 9:16, 1:1, or 4:5 — free and local",
    description:
      "Resize a horizontal video for Reels, Shorts, TikTok, or a square feed post. Crop to fill or pad with black bars. Runs entirely in your browser.",
    intro:
      "A horizontal clip does not fit a vertical feed. Choose an aspect ratio and ClipKit scales the video to cover the frame, then crops the overflow from the center. Choose Pad instead if you need the whole frame visible, for example a screen recording or a wide shot you cannot lose.",
    icon: "crop",
    accent: "sky",
    keywords: ["crop video 9:16", "video resizer", "16:9 to 9:16", "instagram reel size"],
    steps: [
      { name: "Load the clip", text: "Drop a video and ClipKit reads its dimensions." },
      { name: "Choose the frame", text: "Pick 9:16 for Reels and Shorts, 1:1 for a square post, 4:5 for a portrait feed, or a custom size." },
      { name: "Pick crop or pad", text: "Crop fills the frame and trims the edges. Pad keeps the whole frame and adds bars." },
      { name: "Download", text: "The new video is encoded at the chosen resolution and saved locally." },
    ],
    faqs: [
      {
        question: "What size should a Reel or Short be?",
        answer:
          "Use 1080 x 1920 (9:16). That is the baseline for Instagram Reels, YouTube Shorts, and TikTok. A 720 x 1280 export is smaller and still accepted, but 1080 x 1920 is the safe choice for a crisp upload.",
      },
      {
        question: "Should I crop or pad?",
        answer:
          "Crop when the important subject is in the middle and the edges are expendable. Pad when the whole frame matters, such as a tutorial, a screen recording, or a group shot. Padding adds bars; it does not invent picture outside the original frame.",
      },
      {
        question: "Does resizing reduce quality?",
        answer:
          "Any re-encode loses a little quality. Upscaling a small clip to 1080p cannot add detail. For the best result, start from the highest-resolution source you have and export once, at the final size.",
      },
      {
        question: "Can I choose a custom size?",
        answer:
          "Yes. Pick Custom and enter the width and height in pixels. Keep both dimensions even numbers; most video encoders require it.",
      },
    ],
    related: ["compress", "trim", "convert"],
  },
  {
    slug: "trim",
    kind: "video",
    name: "Trim video",
    short: "Cut the dead air at the start and end.",
    title: "Trim a video online — accurate cuts, no upload",
    description:
      "Cut a video to the exact start and end time you need. Frame-accurate re-encoding in your browser. No account, no watermark, no upload.",
    intro:
      "Enter a start time, an end time, or both. ClipKit re-encodes the selected range rather than copying whole keyframes, so the cut lands where you asked instead of a second or two earlier. That matters for short-form video, where the first frame is the hook.",
    icon: "trim",
    accent: "peach",
    keywords: ["trim video online", "cut video", "video trimmer", "trim mp4"],
    steps: [
      { name: "Drop the video", text: "ClipKit shows the duration so you can choose the range." },
      { name: "Set start and end", text: "Type a timecode such as 0:04 or 1:02:10. Leave end empty to keep the rest." },
      { name: "Trim", text: "The selected range is re-encoded for an accurate cut and saved to your device." },
    ],
    faqs: [
      {
        question: "Is the cut frame-accurate?",
        answer:
          "Yes. ClipKit re-encodes the range, so it does not snap to the nearest keyframe. The tradeoff is speed: a re-encode takes longer than a stream copy, especially on a phone.",
      },
      {
        question: "Can I remove the middle of a video?",
        answer:
          "Not in this version. ClipKit trims from the start, the end, or both. To remove a section in the middle, export the two remaining pieces and join them in an editor.",
      },
      {
        question: "Does trimming change the resolution?",
        answer:
          "No. The frame size stays the same unless you also use the resize tool. The video and audio codecs are re-encoded to MP4 with H.264 and AAC.",
      },
      {
        question: "Why does the timer not match the file exactly?",
        answer:
          "Players round to the nearest second, and some containers store a slightly different duration than the visible video. Use the preview timecode as a guide, then check the exported clip.",
      },
    ],
    related: ["compress", "resize", "convert"],
  },
  {
    slug: "convert",
    kind: "video",
    name: "Convert video",
    short: "MP4, WebM, GIF, or audio — one clean export.",
    title: "Convert video online — MP4, WebM, GIF, MP3",
    description:
      "Convert MOV to MP4, MP4 to WebM, video to GIF, or video to MP3 in your browser. No upload, no account, no watermark.",
    intro:
      "Different platforms want different containers. MP4 with H.264 plays everywhere. WebM is smaller for the web. GIF loops without a player. MP3 is the audio track on its own. Pick a format and ClipKit encodes it locally.",
    icon: "convert",
    accent: "violet",
    keywords: ["convert mov to mp4", "mp4 to webm", "video to gif", "video converter"],
    steps: [
      { name: "Add a video", text: "Any common container is accepted: MP4, MOV, WebM, MKV, or AVI." },
      { name: "Choose a format", text: "MP4 for compatibility, WebM for size, GIF for a short loop, or an audio format." },
      { name: "Convert", text: "The encoder runs in the page and produces a download when it finishes." },
    ],
    faqs: [
      {
        question: "Which format should I use?",
        answer:
          "Use MP4 with H.264 for almost everything: phones, browsers, Instagram, YouTube, and email. Use WebM when you control the player and want a smaller file. Use GIF only for very short, silent loops.",
      },
      {
        question: "Why is my GIF so large?",
        answer:
          "GIF has no inter-frame compression worth using, so it is a poor format for long or high-resolution video. Keep GIFs under 6 seconds and 640 px wide, or use an MP4 loop instead.",
      },
      {
        question: "Is MOV the same as MP4?",
        answer:
          "They are related containers, but not identical. iPhones often record MOV with HEVC, which some Android apps and browsers cannot open. Converting to MP4 with H.264 is the most compatible choice.",
      },
      {
        question: "Can I convert without losing quality?",
        answer:
          "A re-encode always loses a little. To keep the original quality, use a stream copy when the codecs already match, or export at a high bitrate. ClipKit re-encodes because it needs to guarantee compatibility.",
      },
    ],
    related: ["compress", "audio", "resize"],
  },
  {
    slug: "audio",
    kind: "video",
    name: "Extract audio",
    short: "Pull the sound out as MP3, WAV, or M4A.",
    title: "Extract audio from video — MP3, WAV, M4A",
    description:
      "Turn a video into an audio file in your browser. Choose MP3, WAV, or M4A, set the bitrate, and download. Nothing is uploaded.",
    intro:
      "Useful for turning a recorded talk into a podcast track, saving a voice memo, or pulling a music bed out of your own footage. Choose MP3 for small files, WAV for editing, or M4A for a good size-to-quality balance.",
    icon: "audio",
    accent: "gold",
    keywords: ["extract audio from video", "video to mp3", "mp4 to mp3", "video to wav"],
    steps: [
      { name: "Add the video", text: "ClipKit reads the file and shows its duration." },
      { name: "Choose audio settings", text: "Pick MP3, WAV, or M4A and a bitrate. 192 kbps is a good default for music and speech." },
      { name: "Extract", text: "The audio track is encoded and saved to your device." },
    ],
    faqs: [
      {
        question: "Which audio format is best?",
        answer:
          "MP3 at 192 kbps is fine for listening and sharing. WAV is uncompressed and better if you will edit the audio. M4A (AAC) is efficient and plays on Apple devices and most browsers.",
      },
      {
        question: "Does extracting audio keep the original quality?",
        answer:
          "Only if the source audio is already compressed at a similar or lower bitrate. Re-encoding a 128 kbps track at 320 kbps does not add detail. Choose a bitrate at or above the source for the least loss.",
      },
      {
        question: "Can I extract audio from a video I do not own?",
        answer:
          "Only if you have permission or the licence allows it. ClipKit is a tool, not a rights grant. Downloading or reusing someone else's audio can infringe copyright even when the file is for personal use.",
      },
      {
        question: "Why is the audio out of sync?",
        answer:
          "Audio and video timestamps can drift in variable-frame-rate recordings. Re-encoding the audio usually fixes it. If the source is damaged, try a different container or re-record the audio.",
      },
    ],
    related: ["convert", "trim", "compress"],
  },
  {
    slug: "frame",
    kind: "video",
    name: "Save a frame",
    short: "Grab a clean still for a thumbnail or cover.",
    title: "Extract a frame from a video — PNG or JPG",
    description:
      "Save any frame from a video as a PNG or JPG image. Choose the timestamp, preview the result, and download. Runs locally in your browser.",
    intro:
      "A good cover frame can decide whether someone stops scrolling. Scrub to the moment, pick a timestamp, and export a full-resolution still. PNG keeps text and graphics sharp; JPG is smaller for the web.",
    icon: "frame",
    accent: "rose",
    keywords: ["extract frame from video", "video screenshot", "thumbnail from video", "save video frame"],
    steps: [
      { name: "Load the video", text: "Drop the clip and check the duration." },
      { name: "Choose a timestamp", text: "Enter the moment you want, such as 0:03.5." },
      { name: "Save the frame", text: "Export a PNG or JPG at the video's native resolution." },
    ],
    faqs: [
      {
        question: "What image format should I use?",
        answer:
          "PNG for crisp text, logos, and graphics. JPG for a smaller photo-like still. Both are exported at the video's resolution, so a 1080p clip gives a 1920 x 1080 frame.",
      },
      {
        question: "Can I get a frame from a vertical video?",
        answer:
          "Yes. The export keeps the source orientation, so a 1080 x 1920 Reel produces a 1080 x 1920 image.",
      },
      {
        question: "Why is the frame black?",
        answer:
          "The timestamp may be before the first decodable frame or after the end. Try a second later. Some codecs need a keyframe before the requested time, and ClipKit seeks to the nearest decodable frame.",
      },
      {
        question: "Can I use the frame as a YouTube thumbnail?",
        answer:
          "Yes, if you own the video and the people in it. YouTube recommends 1280 x 720. A 1080p frame is larger, so resize it down before uploading.",
      },
    ],
    related: ["resize", "trim", "convert"],
  },
  {
    slug: "captions",
    kind: "video",
    name: "Convert subtitles",
    short: "SRT to VTT, VTT to SRT, or shift the timing.",
    title: "SRT to VTT converter — free, instant, no upload",
    description:
      "Convert SRT to VTT or VTT to SRT, clean cue settings, and shift subtitle timing. Runs in your browser with no upload and no account.",
    intro:
      "Web players want VTT. Editors and older platforms want SRT. Paste a file or drop it in, choose the output, and copy or download the result. You can also shift every cue by a number of seconds when the captions drift.",
    icon: "captions",
    accent: "mint",
    keywords: ["srt to vtt", "vtt to srt", "subtitle converter", "shift subtitles"],
    steps: [
      { name: "Add a subtitle file", text: "Drop an .srt or .vtt file, or paste the text." },
      { name: "Choose the output", text: "Convert to VTT, convert to SRT, or shift the timing by a positive or negative offset." },
      { name: "Copy or download", text: "The converted file is created in the page. Nothing is sent to a server." },
    ],
    faqs: [
      {
        question: "What is the difference between SRT and VTT?",
        answer:
          "SRT is the older, simpler format: an index, a timestamp with a comma before milliseconds, and the text. VTT adds a WEBVTT header, uses a dot before milliseconds, and supports cue settings such as alignment and position.",
      },
      {
        question: "Why do my subtitles show the wrong characters?",
        answer:
          "The file is probably not UTF-8. Re-save it as UTF-8 in a text editor, then convert again. ClipKit reads the text as UTF-8 in the browser.",
      },
      {
        question: "How do I shift subtitles?",
        answer:
          "Enter a positive number to move every cue later, or a negative number to move them earlier. For example, -1.5 moves the captions 1.5 seconds earlier to match audio that starts sooner.",
      },
      {
        question: "Does converting change the caption text?",
        answer:
          "No. ClipKit changes the header, timestamp separators, and cue numbering only. The spoken text is preserved. Cue settings that SRT cannot represent are removed when converting from VTT.",
      },
    ],
    related: ["trim", "audio", "compress"],
  },
  {
    slug: "compress-image",
    kind: "image",
    name: "Compress image",
    short: "Hit a target file size without turning the photo to mud.",
    title: "Compress an image online — target a file size, no upload",
    description:
      "Compress JPG, PNG, WebP, HEIC, and AVIF images to a target size in your browser. Cap the dimensions, keep the best quality that fits, and download. No upload, no account, no watermark.",
    intro:
      "An upload form says the photo must be under 200 KB. A website is slow because every image is 4 MB. Pick a target size and ClipKit searches for the highest quality that fits, reducing the dimensions only when quality alone cannot get there. The file never leaves your device.",
    icon: "image-compress",
    accent: "lime",
    keywords: [
      "compress image",
      "image compressor",
      "reduce image size",
      "compress image to 200kb",
      "compress jpg",
      "compress png",
    ],
    steps: [
      {
        name: "Choose the image",
        text: "Drop a JPG, PNG, WebP, HEIC, AVIF, GIF, or BMP file. ClipKit reads its dimensions and size locally.",
      },
      {
        name: "Set a target",
        text: "Pick a common limit such as 200 KB or 1 MB, or type your own. You can also cap the long edge at 2560, 1920, 1280, or 800 px.",
      },
      {
        name: "Compress and download",
        text: "The browser encodes the image at several quality levels and keeps the best one under your target. If it has to reduce the dimensions, it tells you exactly what it did.",
      },
    ],
    faqs: [
      {
        question: "How does target-size compression work?",
        answer:
          "For JPG and WebP, ClipKit encodes the image repeatedly and binary-searches the quality setting until the file is just under your target. If even the lowest quality is still too large, it reduces the dimensions in steps. PNG is lossless, so it can only reach a target by reducing dimensions.",
      },
      {
        question: "Will compressing an image make it blurry?",
        answer:
          "A smaller file needs fewer bits, so some detail has to go. The tool protects quality by keeping the dimensions and lowering compression strength first. If the target is extremely small, reducing the long edge usually looks better than crushing the quality to 30 percent. Compare the before and after previews before you download.",
      },
      {
        question: "Should I compress a PNG or convert it to JPG?",
        answer:
          "PNG is the right choice for screenshots, logos, and images with transparency. For photographs, JPG or WebP reaches a much smaller size at the same visible quality. If the PNG has no transparency, converting it to JPG first is often the single biggest saving.",
      },
      {
        question: "Does ClipKit upload my image?",
        answer:
          "No. The image is decoded and re-encoded by your browser using the canvas API. There is no upload endpoint, no account, and no server-side copy. You can disconnect from the internet after the page loads and the tool still works.",
      },
      {
        question: "What is a realistic target size?",
        answer:
          "A 1080 px photo usually looks clean between 150 and 400 KB. A 200 KB target is common for job portals and email. Website hero images often work at 100 to 250 KB when capped at 1600 px wide. Below about 50 KB, a full-resolution photo will show compression artifacts.",
      },
    ],
    related: ["resize-image", "convert-image", "heic-to-jpg"],
  },
  {
    slug: "resize-image",
    kind: "image",
    name: "Resize image",
    short: "Crop or pad a photo to a platform-perfect size.",
    title: "Resize an image online — Instagram, YouTube, and link preview sizes",
    description:
      "Resize and crop images to 1080 × 1350, 1080 × 1920, 1280 × 720, 1200 × 630, and more. Crop to fill or pad with a color. Runs entirely in your browser, with no upload.",
    intro:
      "Every feed crops differently. A landscape photo becomes a vertical Story, a square post becomes a link preview, and a screenshot needs exact pixels for an app store. Choose a platform preset or type your own size, then crop to fill the frame or pad the whole image onto a background.",
    icon: "image-resize",
    accent: "sky",
    keywords: [
      "resize image",
      "image resizer",
      "crop image online",
      "resize image for instagram",
      "youtube thumbnail size",
      "1080x1350",
    ],
    steps: [
      {
        name: "Load the image",
        text: "Drop a JPG, PNG, WebP, HEIC, AVIF, GIF, or BMP file. ClipKit shows the source dimensions.",
      },
      {
        name: "Pick a preset or exact size",
        text: "Choose Instagram post, square, Story, YouTube thumbnail, link preview, X post, LinkedIn, or an app icon. Custom accepts any size up to the canvas limit.",
      },
      {
        name: "Crop or pad",
        text: "Crop to fill keeps the centre and trims the edges. Pad to fit keeps the whole image and adds a background colour or transparency.",
      },
      {
        name: "Export",
        text: "Choose JPG, PNG, or WebP, set the quality, and download the resized image from your device.",
      },
    ],
    faqs: [
      {
        question: "What is the best Instagram image size?",
        answer:
          "Use 1080 × 1350 for a portrait feed post (4:5), 1080 × 1080 for a square post, and 1080 × 1920 for a Story or Reel cover (9:16). Instagram compresses uploads again, so start from a sharp source and avoid upscaling a small image.",
      },
      {
        question: "What size should a YouTube thumbnail be?",
        answer:
          "YouTube recommends 1280 × 720 (16:9), at least 1280 px wide, and under 2 MB. The preset in ClipKit uses those exact dimensions. Keep important text away from the bottom-right corner, where the duration badge sits.",
      },
      {
        question: "What does crop to fill mean?",
        answer:
          "Crop scales the image until it covers the whole frame, then trims the overflow from the centre. Nothing is stretched. If the subject is near an edge, check the preview: a centre crop can cut it off. Pad is the safer choice for screenshots and diagrams.",
      },
      {
        question: "Does resizing up add detail?",
        answer:
          "No. Upscaling interpolates existing pixels and can look soft. Use the largest source you have and resize down to the final dimensions. For print or a large banner, start from a higher-resolution original rather than enlarging a small file.",
      },
      {
        question: "Can I resize an image without losing transparency?",
        answer:
          "Yes. Choose PNG, or WebP in a browser that can encode it. With Pad selected, enable transparent padding. JPG has no alpha channel, so transparent areas are filled with the background colour you choose.",
      },
    ],
    related: ["compress-image", "convert-image", "heic-to-jpg"],
  },
  {
    slug: "convert-image",
    kind: "image",
    name: "Convert image",
    short: "JPG, PNG, and WebP in one clean pass.",
    title: "Convert images online — JPG, PNG, and WebP, no upload",
    description:
      "Convert JPG to PNG, PNG to JPG, WebP to JPG, or HEIC to JPG in your browser. Control quality, handle transparency, and strip metadata. No upload, no account, no watermark.",
    intro:
      "Formats are a compatibility problem, not a quality problem. A screenshot saved as JPG picks up artifacts around text. A photo saved as PNG is needlessly large. A WebP downloaded from a website will not open in an older editor. Pick the output that fits the destination, and ClipKit encodes it locally.",
    icon: "image-convert",
    accent: "violet",
    keywords: [
      "image converter",
      "png to jpg",
      "jpg to png",
      "webp to jpg",
      "webp to png",
      "convert image",
    ],
    steps: [
      {
        name: "Add an image",
        text: "Drop a JPG, PNG, WebP, AVIF, GIF, BMP, HEIC, or HEIF file. The source format and dimensions are detected locally.",
      },
      {
        name: "Choose the output",
        text: "Pick JPG for compatibility, PNG for lossless graphics and transparency, or WebP for a smaller web file.",
      },
      {
        name: "Set quality and transparency",
        text: "JPG and WebP use the quality slider. When a transparent image is exported to JPG, choose the colour that fills the empty pixels.",
      },
      {
        name: "Convert and download",
        text: "The browser re-encodes the image and saves it to your device. Metadata such as GPS coordinates is not copied.",
      },
    ],
    faqs: [
      {
        question: "Which format should I choose?",
        answer:
          "JPG for photographs and anything that must open everywhere. PNG for screenshots, logos, diagrams, and images with transparency. WebP for websites when you control the audience and want a smaller file. There is no single best format; it depends on the content and where it is going.",
      },
      {
        question: "Does converting PNG to JPG lose quality?",
        answer:
          "Yes, slightly, because JPG is lossy and PNG is not. At 90 percent quality the difference is hard to see in a photo, but sharp text and flat graphics can show ringing. Keep the PNG original if you may need to edit it again, and convert a copy for sharing.",
      },
      {
        question: "Can I convert WebP to JPG?",
        answer:
          "Yes. ClipKit decodes WebP with the browser and exports JPG or PNG. This is useful when an older editor, a print shop, or an upload form rejects WebP. Converting to JPG flattens transparency, so choose a background colour first.",
      },
      {
        question: "Does the converted file keep EXIF and GPS data?",
        answer:
          "No. The image is drawn to a canvas and re-encoded, so EXIF, GPS, camera model, and most other metadata are not carried over. Orientation is applied to the pixels before export, so the image still appears upright. This is usually good for privacy, but it also removes copyright and colour-profile metadata.",
      },
      {
        question: "Why can't I choose WebP in Safari?",
        answer:
          "Safari can display WebP but cannot encode it from a canvas; it silently returns a PNG instead. ClipKit probes the browser at runtime and disables WebP export when the encoder is missing, so you never download a file with the wrong extension. Use JPG or PNG in Safari, or convert in Chrome, Edge, or Firefox.",
      },
    ],
    related: ["compress-image", "resize-image", "heic-to-jpg"],
  },
  {
    slug: "heic-to-jpg",
    kind: "image",
    name: "HEIC to JPG",
    short: "Open iPhone photos on Windows, Android, or any upload form.",
    title: "HEIC to JPG converter — free, private, no upload",
    description:
      "Convert iPhone HEIC and HEIF photos to JPG in your browser. No upload, no account, no watermark. Works on Windows, Android, Mac, and Chromebooks.",
    intro:
      "iPhones save photos as HEIC: smaller than JPG, but many Windows apps, Android phones, and upload forms still refuse to open it. Drop the photo here and ClipKit decodes it on your device, applies the orientation, and exports a standard JPG that works everywhere.",
    icon: "heic",
    accent: "gold",
    keywords: [
      "heic to jpg",
      "heic to jpeg",
      "convert heic to jpg",
      "heic converter",
      "iphone photo to jpg",
      "heif to jpg",
    ],
    steps: [
      {
        name: "Add the HEIC photo",
        text: "Drop a .heic or .heif file from an iPhone, iPad, or camera. The file is read locally, not uploaded.",
      },
      {
        name: "Wait for the local decoder",
        text: "Safari uses the system HEIC decoder. Chrome, Edge, and Firefox download a 3 MB decoder once, only when a HEIC file is selected.",
      },
      {
        name: "Check the preview",
        text: "Confirm the photo looks right and is the expected size. Live Photos and some 10-bit HDR variants may not decode.",
      },
      {
        name: "Download the JPG",
        text: "Export a standard JPG at up to 90 percent quality. GPS and camera metadata are not copied.",
      },
    ],
    faqs: [
      {
        question: "Why won't Windows open a HEIC file?",
        answer:
          "HEIC is an Apple-led variant of the HEIF container, and Windows does not include a decoder by default. Microsoft sells a HEIF Image Extensions package for some editions, but the simpler fix is to convert the photo to JPG, which every Windows app can open.",
      },
      {
        question: "Is this HEIC converter really private?",
        answer:
          "Yes. The photo is read from your disk, decoded in the tab, and encoded back to a downloadable file. There is no upload endpoint. On Safari the system decoder is used. On other browsers the open-source libheif decoder is downloaded once and runs locally in WebAssembly.",
      },
      {
        question: "Why does it take longer the first time?",
        answer:
          "Chrome, Edge, and Firefox need a WebAssembly HEIC decoder. It is about 3 MB, loaded only when you select a HEIC file, and cached by the browser for later visits. Safari has a native decoder, so the first conversion is immediate.",
      },
      {
        question: "Does the JPG keep the photo's location data?",
        answer:
          "No. Metadata is stripped during the canvas re-encode, including GPS coordinates, camera model, and capture time. The image is rotated upright before export. If you need to preserve metadata for an archive, keep the original HEIC file as well.",
      },
      {
        question: "Which HEIC files are not supported?",
        answer:
          "Most single-image HEIC photos work. Live Photos, burst sequences, some 10-bit HDR captures, and unusual HEIF profiles may fail because they contain multiple images or codecs the decoder does not handle. If a file fails, open it in Photos on the iPhone, tap Share, and choose Copy Photo or save it as a JPEG, then convert that copy.",
      },
      {
        question: "Does converting HEIC to JPG reduce quality?",
        answer:
          "A little. HEIC is more efficient, so the same visual quality takes fewer bytes. Exporting at 90 percent JPG keeps the photo clean for sharing and printing at normal sizes, but the file will usually be larger than the HEIC original. That is the cost of compatibility.",
      },
    ],
    related: ["convert-image", "compress-image", "resize-image"],
  },
];

export const VIDEO_TOOLS = TOOLS.filter((tool) => tool.kind === "video");
export const IMAGE_TOOLS = TOOLS.filter((tool) => tool.kind === "image");

export function toolBySlug(slug: string): ToolDef | undefined {
  return TOOLS.find((tool) => tool.slug === slug);
}
