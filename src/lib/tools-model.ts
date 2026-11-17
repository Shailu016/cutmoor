import type { ToolDef } from "./tools";

/**
 * The two picture tools that run a neural network on the visitor's device. They are listed in tools.ts only when the
 * model files are published (MODEL_TOOLS_PUBLISHED in modeltools/manifests.ts) or in a development build, so no visitor
 * reaches a page whose download would fail.
 */
export const MODEL_TOOLS: ToolDef[] = [
  {
    slug: "remove-background",
    kind: "image",
    name: "Remove background",
    short: "Cut out the subject and drop the background, on your device.",
    title: "Remove an image background online, no upload",
    description: "Remove the background from a photo in your browser with an AI model that runs on your device. Save a transparent PNG. Your picture is never uploaded.",
    intro:
      "Cut a person, product, or pet out of its background without sending the photo anywhere. A small AI model is downloaded once to your browser, finds the subject, and makes the rest transparent. Choose a soft or sharp edge, a solid colour behind it, and save a PNG. The picture never leaves your device.",
    icon: "background",
    accent: "mint",
    keywords: ["remove background from image", "background remover", "transparent background", "cut out image", "remove bg online free"],
    steps: [
      { name: "Choose the picture", text: "Drop a JPG, PNG, WebP, AVIF, GIF, BMP, or HEIC file. A clear subject works best." },
      { name: "Approve the one-time download", text: "The page tells you the size and where it comes from before anything is downloaded. The model is checked against a fingerprint and kept in your browser." },
      { name: "Pick the edge and background", text: "Choose Soft, Normal, or Sharp, a transparent or solid background, and whether to trim the empty space." },
      { name: "Save", text: "Download a transparent PNG or WebP, or a JPG with a solid colour behind the subject." },
    ],
    faqs: [
      {
        question: "Is my photo uploaded to a server?",
        answer:
          "No. The AI model is downloaded to your browser and runs there, on your graphics card when you have one and on your processor otherwise. The only request is for the model file, once, after you agree.",
      },
      {
        question: "How good is it compared with online background removers?",
        answer:
          "It finds a clear subject well: people, products, pets, and objects against a different background. Fine hair, glass, smoke, and subjects that blend into their surroundings are the hardest cases, and the result can need a touch-up. Check the edges before you use it.",
      },
      {
        question: "What is downloaded, and how big is it?",
        answer:
          "A background-removal model of about 88 MB plus a shared 29 MB engine that runs it. Each file is checked against a SHA-256 fingerprint shipped with the site and saved in your browser, so later visits download nothing.",
      },
      {
        question: "Which file should I save?",
        answer: "PNG or WebP keep the transparency. JPG cannot be see-through, so choose a solid background colour if you want JPG.",
      },
    ],
    related: ["crop-image", "convert-image", "blur-image"],
  },
  {
    slug: "upscale-image",
    kind: "image",
    name: "Enlarge picture",
    short: "Make a small or soft picture 2x or 4x bigger with AI.",
    title: "Upscale an image 2x or 4x with AI, no upload",
    description: "Enlarge a small or blurry picture 2x or 4x in your browser with an AI upscaler that runs on your device. No upload, no watermark, no account.",
    intro:
      "Make a small picture bigger without it turning to mush. A compact AI model, downloaded once to your browser, enlarges the picture two or four times and adds believable sharpness. It runs on your device in small pieces, so the picture is never uploaded. It cannot recover detail that was never in the picture, and the tool says so.",
    icon: "upscale",
    accent: "violet",
    keywords: ["upscale image", "enlarge image", "ai image upscaler", "increase image resolution", "make picture bigger without losing quality"],
    steps: [
      { name: "Choose the picture", text: "Drop a JPG, PNG, WebP, AVIF, GIF, BMP, or HEIC file. Small or soft pictures gain the most." },
      { name: "Approve the one-time download", text: "The model is about 5 MB plus a shared 29 MB engine. You see the size and the host first, and it is saved in your browser." },
      { name: "Pick 2x or 4x", text: "The new size is shown. Results that would be larger than a browser can draw are refused with a clear message." },
      { name: "Enlarge and save", text: "Cutmoor enlarges the picture in pieces on your device and saves a PNG, JPG, or WebP." },
    ],
    faqs: [
      {
        question: "Does AI upscaling add real detail?",
        answer:
          "It adds believable detail: edges become crisper and textures sharper than with plain stretching. It cannot know what was in the picture, so faces and small text can look slightly changed. Do not use it where exactness matters, such as documents or evidence.",
      },
      {
        question: "How big a picture can I enlarge?",
        answer:
          "A browser canvas holds about 16.7 million pixels. At 4x that means pictures up to about one megapixel (1024 by 1024); at 2x, up to about four megapixels. The tool shows the result size before you start.",
      },
      {
        question: "Is my picture uploaded?",
        answer: "No. The model is downloaded once and runs in your browser. Your picture and the enlarged result stay on your device.",
      },
      {
        question: "Why is it slow on some computers?",
        answer: "The picture is enlarged in many small pieces. A graphics card does this several times faster than a processor, and larger pictures need more pieces.",
      },
    ],
    related: ["resize-image", "compress-image", "crop-image"],
  },
];
