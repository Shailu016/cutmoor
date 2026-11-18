import type { ToolDef } from "./tools";

/**
 * The video editing tools added after the first set: mute, rotate, speed, reverse, loop, GIF, merge, watermark,
 * add sound, slideshow. Same shape as the entries in tools.ts, kept in their own file so each file stays readable.
 */
export const VIDEO_EDIT_TOOLS: ToolDef[] = [
  {
    slug: "mute-video",
    kind: "video",
    name: "Mute video",
    short: "Remove the sound from a video in one click.",
    title: "Mute a video online: remove the sound, no upload",
    description: "Remove the audio track from an MP4, MOV, or WebM video in your browser. The picture is kept, the sound is gone, and the file never leaves your device.",
    intro:
      "Strip the sound from a video without opening an editor. Cutmoor keeps every frame and writes a new MP4 with no audio track at all, so there is nothing left to un-mute. It runs in your browser: the video is read from your disk and written back, never uploaded.",
    icon: "mute",
    accent: "sky",
    keywords: ["mute video", "remove audio from video", "video without sound", "remove sound from video online"],
    steps: [
      { name: "Choose the video", text: "Drop an MP4, MOV, WebM, MKV, or AVI file. It is read on your device." },
      { name: "Remove the sound", text: "Press the button. The audio track is dropped and the picture is re-encoded to a standard MP4." },
      { name: "Download", text: "Save the silent MP4. Add new music or a voice-over later with the Add music tool." },
    ],
    faqs: [
      {
        question: "Does muting a video lower its quality?",
        answer:
          "The picture is re-encoded once with a high-quality H.264 setting, so there is a very small generation loss, usually not visible. The sound is removed completely rather than turned down.",
      },
      {
        question: "Can I mute only part of a video?",
        answer:
          "Not with this tool: it removes the whole sound track. To silence a section, trim the video into pieces, mute the piece you want, and join them again with Merge videos.",
      },
      {
        question: "Is my video uploaded anywhere?",
        answer: "No. The file is processed by an encoder that runs in this tab. There is no upload step and no account.",
      },
    ],
    related: ["add-audio-to-video", "trim", "compress"],
  },
  {
    slug: "rotate-video",
    kind: "video",
    name: "Rotate video",
    short: "Turn a sideways video upright, or flip it.",
    title: "Rotate or flip a video online, no upload",
    description: "Rotate a video 90, 180, or 270 degrees, or mirror it left to right or top to bottom. Fix sideways phone videos in your browser without uploading anything.",
    intro:
      "A video that plays sideways or upside down is fixed in seconds: pick a turn, add a mirror if you want one, and Cutmoor writes a corrected MP4. The sound is kept. Everything runs on your device, so a private clip stays private.",
    icon: "rotate",
    accent: "violet",
    keywords: ["rotate video", "flip video", "mirror video", "fix sideways video", "rotate video 90 degrees"],
    steps: [
      { name: "Choose the video", text: "Drop an MP4, MOV, WebM, MKV, or AVI file." },
      { name: "Pick the turn", text: "Choose 90 degrees right, 180 degrees, or 90 degrees left, and add a left-right or top-bottom mirror if needed." },
      { name: "Rotate and download", text: "The video is re-encoded to an MP4 with the turn applied. The new size is shown before you start." },
    ],
    faqs: [
      {
        question: "Why does my phone video play sideways on some devices?",
        answer:
          "Phones often store the picture unrotated and add a note saying how to turn it. Some players ignore that note. Rotating the video here writes the correct orientation into the picture itself, so it looks the same everywhere.",
      },
      {
        question: "Does rotating change the video size?",
        answer: "A 90 degree turn swaps width and height, so a 1920 by 1080 clip becomes 1080 by 1920. A 180 degree turn keeps the size.",
      },
      {
        question: "Does the sound stay?",
        answer: "Yes. The audio is kept and re-encoded to AAC. If the video has no sound, the result has none either.",
      },
    ],
    related: ["resize", "mute-video", "trim"],
  },
  {
    slug: "video-speed",
    kind: "video",
    name: "Change video speed",
    short: "Slow motion or fast forward, with the sound kept in step.",
    title: "Change video speed online: slow motion and fast forward",
    description: "Speed a video up to 4x or slow it to 0.25x in your browser. The sound follows the picture. No upload, no watermark, no account.",
    intro:
      "Make a clip play faster or in slow motion. Choose a preset from 0.25x to 4x or drag to an exact speed, and Cutmoor re-times the picture and the sound together. It runs in your browser, so the video is never sent to a server.",
    icon: "speed",
    accent: "peach",
    keywords: ["change video speed", "slow motion video", "speed up video", "video speed controller", "fast forward video"],
    steps: [
      { name: "Choose the video", text: "Drop an MP4, MOV, WebM, MKV, or AVI file." },
      { name: "Pick a speed", text: "Use a preset such as 0.5x or 2x, or set an exact value between 0.25x and 4x. The new length is shown." },
      { name: "Export", text: "Cutmoor writes a new MP4 with the picture and sound re-timed together." },
    ],
    faqs: [
      {
        question: "Will slow motion look smooth?",
        answer:
          "It is as smooth as the original footage allows. Slowing a 30 frames per second clip to 0.25x stretches each frame, so it can look steppy. Footage recorded at 60 or 120 frames per second slows down much more cleanly.",
      },
      {
        question: "Does the voice sound squeaky when sped up?",
        answer: "No. The sound is time-stretched, not just played faster, so the pitch stays natural. Very high or low speeds can still sound a little processed.",
      },
      {
        question: "What are the limits?",
        answer: "Speed can be set from 0.25x to 4x. For other changes, run the tool twice, for example 4x and then 2x for 8x.",
      },
    ],
    related: ["trim", "reverse-video", "loop-video"],
  },
  {
    slug: "reverse-video",
    kind: "video",
    name: "Reverse video",
    short: "Play a clip backwards, sound included.",
    title: "Reverse a video online: play it backwards",
    description: "Reverse a short video so it plays from the last frame to the first, with the sound reversed too. Runs in your browser, no upload.",
    intro:
      "Play a clip backwards for a rewind effect. Cutmoor reverses the picture and the sound and saves a new MP4. Reversing needs the whole clip in memory at once, so it suits short clips; if a clip is too big the tool says so before it starts.",
    icon: "reverse",
    accent: "rose",
    keywords: ["reverse video", "play video backwards", "video reverser", "rewind video effect"],
    steps: [
      { name: "Choose a short video", text: "Drop an MP4, MOV, WebM, MKV, or AVI file. Clips under a minute work best." },
      { name: "Reverse", text: "Cutmoor checks the clip will fit in memory, then reverses the frames and the sound." },
      { name: "Download", text: "Save the reversed MP4." },
    ],
    faqs: [
      {
        question: "Why is there a length limit?",
        answer:
          "To play frames backwards the encoder must hold all of them in memory first. A minute of full HD video can need several gigabytes, more than a browser tab can use. Trim the clip or lower its resolution if the tool refuses.",
      },
      {
        question: "Can I make a clip play forwards then backwards?",
        answer: "Reverse the clip, then join the original and the reversed copy in order with Merge videos.",
      },
      {
        question: "Is the sound reversed too?",
        answer: "Yes. Speech will sound backwards. If you want silence instead, run the result through Mute video.",
      },
    ],
    related: ["video-speed", "loop-video", "merge-videos"],
  },
  {
    slug: "loop-video",
    kind: "video",
    name: "Loop video",
    short: "Repeat a clip several times into one video.",
    title: "Loop a video online: repeat a clip 2 to 10 times",
    description: "Repeat a short video 2 to 10 times and save it as one MP4 that loops anywhere. Runs in your browser with no upload or watermark.",
    intro:
      "Turn a short clip into a longer one by repeating it. Cutmoor plays the clip the number of times you choose, sound included, and saves a single MP4. Because the repeat is part of the file, it loops on every site and player, not just in one app.",
    icon: "loop",
    accent: "gold",
    keywords: ["loop video", "repeat video", "video looper", "make video loop", "loop video online"],
    steps: [
      { name: "Choose the clip", text: "Drop a short MP4, MOV, WebM, MKV, or AVI file." },
      { name: "Pick the repeats", text: "Choose 2, 3, 4, 5, or 10 plays. The total length is shown, and results over 10 minutes are refused." },
      { name: "Export", text: "Cutmoor writes one MP4 with the clip repeated back to back." },
    ],
    faqs: [
      {
        question: "Will there be a jump at the join?",
        answer: "The clip is repeated exactly as it is, so a join is smooth only if the end of the clip matches its start. Trim the clip to a clean loop point first if you need a seamless result.",
      },
      {
        question: "Why not just use a player's loop setting?",
        answer: "A player setting works only in that player. A looped file keeps repeating when you send it, upload it, or use it as a background.",
      },
      {
        question: "How long can the result be?",
        answer: "Up to 10 minutes. The encoder runs in your browser, so very long results would take a long time and a lot of memory.",
      },
    ],
    related: ["trim", "video-speed", "reverse-video"],
  },
  {
    slug: "gif-to-mp4",
    kind: "video",
    name: "GIF to MP4",
    short: "Turn a GIF into a much smaller MP4.",
    title: "Convert GIF to MP4 online, free and private",
    description: "Convert an animated GIF to an MP4 in your browser. The video is usually many times smaller and plays on Instagram, WhatsApp, and TikTok. No upload.",
    intro:
      "GIFs are big for what they show. Cutmoor turns a GIF into an H.264 MP4: the same animation, usually a fraction of the size, and accepted by social apps that reject GIFs. An odd pixel size is rounded to an even one, because MP4 requires it. Nothing is uploaded.",
    icon: "gif",
    accent: "mint",
    keywords: ["gif to mp4", "convert gif to video", "gif to video", "gif to mp4 converter", "animated gif to mp4"],
    steps: [
      { name: "Choose the GIF", text: "Drop a .gif file. It is decoded on your device." },
      { name: "Convert", text: "The animation is encoded as H.264 video with no audio." },
      { name: "Download", text: "Save the MP4 and upload it wherever GIFs are not accepted." },
    ],
    faqs: [
      {
        question: "Why is the MP4 so much smaller than the GIF?",
        answer: "GIF stores each frame almost independently with only 256 colours. Video compression stores only what changes between frames, so the same animation takes far fewer bytes.",
      },
      {
        question: "Does the MP4 loop?",
        answer: "An MP4 plays once. Many sites loop short videos automatically; for a file that repeats, use the Loop video tool on the result.",
      },
      {
        question: "Will transparency be kept?",
        answer: "No. MP4 has no transparency, so transparent areas become black. Use a PNG or WebM with alpha if you need see-through video.",
      },
    ],
    related: ["compress-gif", "convert", "loop-video"],
  },
  {
    slug: "compress-gif",
    kind: "video",
    name: "Compress GIF",
    short: "Make a GIF smaller with one of four levels.",
    title: "Compress a GIF online: make it smaller, no upload",
    description: "Reduce the file size of an animated GIF in your browser by lowering its size, frame rate, and colours. Four levels, no upload, no watermark.",
    intro:
      "A GIF gets smaller by shrinking its pixels, dropping a few frames, and using fewer colours. Pick Light, Balanced, Small, or Tiny and Cutmoor re-encodes it with an optimised palette. It all happens in your browser, so the animation never leaves your device.",
    icon: "gif",
    accent: "violet",
    keywords: ["compress gif", "reduce gif size", "gif compressor", "make gif smaller", "optimize gif"],
    steps: [
      { name: "Choose the GIF", text: "Drop a .gif file." },
      { name: "Pick a level", text: "Light keeps the most detail; Tiny makes the smallest file by using up to 240 px, 8 frames a second, and 64 colours." },
      { name: "Compress and download", text: "Cutmoor builds a new GIF with a palette made for your animation." },
    ],
    faqs: [
      {
        question: "What makes a GIF smaller?",
        answer: "Fewer pixels, fewer frames per second, and fewer colours. Cutmoor reduces all three together at each level.",
      },
      {
        question: "Is there a smaller format than GIF?",
        answer: "Yes. An MP4 or WebM of the same animation is usually many times smaller. Use GIF to MP4 when the place you are posting accepts video.",
      },
      {
        question: "Will it make the GIF larger if I choose a high level on a small GIF?",
        answer: "A GIF is never made wider than it already is, but a re-encode can occasionally end up a little larger than a tiny original. In that case keep the original.",
      },
    ],
    related: ["gif-to-mp4", "resize-gif", "compress"],
  },
  {
    slug: "resize-gif",
    kind: "video",
    name: "Resize GIF",
    short: "Change a GIF to an exact width.",
    title: "Resize a GIF online to any width, no upload",
    description: "Resize an animated GIF to 160, 240, 320, 480, 640, or 800 pixels wide in your browser. The animation keeps its shape and speed. No upload.",
    intro:
      "Need a GIF that fits a chat window, a forum, or an email? Choose a width and Cutmoor scales the whole animation, keeping its shape and its speed. A GIF is never made wider than it already is, because that only makes it blurry and heavy.",
    icon: "gif",
    accent: "sky",
    keywords: ["resize gif", "gif resizer", "change gif size", "scale gif", "make gif smaller dimensions"],
    steps: [
      { name: "Choose the GIF", text: "Drop a .gif file." },
      { name: "Pick the width", text: "Choose from 160 to 800 pixels. The height follows automatically." },
      { name: "Resize and download", text: "Cutmoor writes a new GIF with an optimised palette." },
    ],
    faqs: [
      {
        question: "Does resizing keep the animation speed?",
        answer: "Yes. The frame rate of the original is kept, within 6 to 20 frames per second, which is what a GIF can reasonably hold.",
      },
      {
        question: "Can I make a GIF bigger?",
        answer: "No. Enlarging a GIF only stretches the same pixels, so it looks blurry and the file grows. Cutmoor keeps the original width if you pick a larger one.",
      },
      {
        question: "Is there a file size limit?",
        answer: "The GIF is processed in your browser's memory, so very large animations can fail on phones. Try a computer or compress the GIF first.",
      },
    ],
    related: ["compress-gif", "gif-to-mp4", "resize"],
  },
  {
    slug: "merge-videos",
    kind: "video",
    name: "Merge videos",
    short: "Join several clips into one video, in your order.",
    title: "Merge videos online: join clips into one, no upload",
    description: "Combine two to ten video clips into one MP4 in your browser. Reorder them, fit them to one size, and keep the sound. No upload, no watermark.",
    intro:
      "Join clips into a single video: add them, put them in order, and choose the picture size. Clips of different shapes are fitted inside the frame with bars rather than stretched, and a clip without sound gets silence so the audio stays in step. The video never leaves your device.",
    icon: "merge",
    accent: "lime",
    keywords: ["merge videos", "join videos", "combine videos", "video joiner", "merge video clips online"],
    steps: [
      { name: "Add the clips", text: "Choose two or more videos, up to ten. Move them up or down to set the order." },
      { name: "Pick the picture size", text: "Match the first clip, or choose 1080p, 720p, vertical 9:16, or square." },
      { name: "Merge and download", text: "Cutmoor joins the clips into one MP4 at 30 frames per second." },
    ],
    faqs: [
      {
        question: "Can I merge clips of different sizes or shapes?",
        answer: "Yes. Each clip is scaled to fit inside the chosen frame and centred, with black bars where its shape differs. Nothing is stretched.",
      },
      {
        question: "What if one clip has no sound?",
        answer: "A silent stretch of the same length is added, so the sound of the other clips stays lined up with their pictures.",
      },
      {
        question: "Why is there a limit of ten clips?",
        answer: "Every clip is held in your browser's memory while it is joined. Ten keeps the job reliable on ordinary laptops. For more, merge in two rounds.",
      },
    ],
    related: ["trim", "compress", "slideshow-maker"],
  },
  {
    slug: "watermark-video",
    kind: "video",
    name: "Watermark video",
    short: "Stamp your name or logo on a video.",
    title: "Add a watermark to a video online, no upload",
    description: "Add text or a logo watermark to a video in your browser. Choose the position, size, and see-through level. Your video is never uploaded.",
    intro:
      "Put your name, handle, or logo on every frame. Type text in any language or pick a logo file, preview where it lands on your own video, then export an MP4 with the mark burned in. The text is drawn by your browser, so Hindi, Arabic, and emoji all work. Nothing is uploaded.",
    icon: "watermark",
    accent: "rose",
    keywords: ["watermark video", "add watermark to video", "add logo to video", "video watermark online", "add text to video"],
    steps: [
      { name: "Choose the video", text: "Drop an MP4, MOV, WebM, MKV, or AVI file. A paused preview appears." },
      { name: "Design the mark", text: "Type your text or pick a logo, choose a corner or the centre, and set the size and how see-through it is." },
      { name: "Export", text: "The mark is burned into every frame of a new MP4. The sound is kept." },
    ],
    faqs: [
      {
        question: "Can I add a logo with a transparent background?",
        answer: "Yes. Use a PNG with transparency and it is placed as it is. A JPG logo keeps its white or coloured box.",
      },
      {
        question: "Can I use Hindi or other scripts?",
        answer: "Yes. The text is drawn by your browser with the fonts on your device, so any script your device can show works.",
      },
      {
        question: "Can the watermark be removed afterwards?",
        answer: "It is part of the picture, so it cannot be switched off. Keep your original file if you may need a clean copy.",
      },
    ],
    related: ["watermark-image", "compress", "resize"],
  },
  {
    slug: "add-audio-to-video",
    kind: "video",
    name: "Add music to video",
    short: "Put music or a voice-over on a video.",
    title: "Add music or audio to a video online, no upload",
    description: "Add an MP3, WAV, or M4A to a video, replacing or mixing with its sound. Set the volume and loop the music. Runs in your browser, no upload.",
    intro:
      "Give a silent clip a soundtrack, or replace the sound of an existing one. Choose an audio file, decide whether to replace or mix with the original sound, set the volume, and Cutmoor writes a new MP4. The video keeps its length. Your files stay on your device.",
    icon: "add-audio",
    accent: "gold",
    keywords: ["add music to video", "add audio to video", "add sound to video", "replace audio in video", "add voiceover to video"],
    steps: [
      { name: "Choose the video", text: "Drop an MP4, MOV, WebM, MKV, or AVI file." },
      { name: "Choose the sound", text: "Pick an MP3, WAV, or M4A file, then replace the original sound or mix both, and set the volume." },
      { name: "Export", text: "Cutmoor writes an MP4 with the new sound, cut or repeated to the length of the video." },
    ],
    faqs: [
      {
        question: "What if the music is shorter than the video?",
        answer: "Tick the repeat option and it plays again until the video ends. Without it, the sound stops and the rest of the video is silent.",
      },
      {
        question: "What if the music is longer?",
        answer: "It is cut when the video ends. The video never gets longer.",
      },
      {
        question: "Is the music licensed for my video?",
        answer: "Cutmoor does not check rights. Use music you made, own, or are licensed to use, especially if you post the video publicly.",
      },
    ],
    related: ["mute-video", "audio", "slideshow-maker"],
  },
  {
    slug: "slideshow-maker",
    kind: "video",
    name: "Photo slideshow video",
    short: "Turn pictures into a video with fades and music.",
    title: "Make a photo slideshow video online, no upload",
    description: "Turn up to 30 photos into an MP4 slideshow with fades and optional music. Choose the size and time per photo. Runs in your browser, no upload.",
    intro:
      "Make a slideshow video from your photos: add them, put them in order, choose how long each shows, and pick a cut or a fade. Add music if you like. iPhone HEIC photos work too. Everything is built on your device, so your pictures are never uploaded.",
    icon: "slideshow",
    accent: "violet",
    keywords: ["photo slideshow maker", "make slideshow video", "images to video", "photos to video", "slideshow with music"],
    steps: [
      { name: "Add your pictures", text: "Choose up to 30 pictures (JPG, PNG, WebP, HEIC) and move them into order." },
      { name: "Set the look", text: "Choose seconds per picture, a cut or fade, the video shape, and whether a picture fills the frame or fits inside it." },
      { name: "Make the video", text: "Cutmoor writes an MP4 at 30 frames per second, with your music if you added some." },
    ],
    faqs: [
      {
        question: "Can I make a vertical slideshow for Reels or Shorts?",
        answer: "Yes. Choose Vertical 9:16 and each picture is placed in a 1080 by 1920 frame.",
      },
      {
        question: "Do my pictures get cropped?",
        answer: "Your choice. Show it all keeps the whole picture with black bars; Fill the frame crops the edges to cover the frame.",
      },
      {
        question: "How many pictures can I use?",
        answer: "Up to 30. Each is prepared in your browser first, so a very large set of big photos takes longer on a phone.",
      },
    ],
    related: ["add-audio-to-video", "convert-image", "compress"],
  },
];
