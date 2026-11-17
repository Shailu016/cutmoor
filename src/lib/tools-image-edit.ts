import type { ToolDef } from "./tools";

/**
 * The picture editing tools added after the first set: crop, rotate, remove hidden data, hide parts of a picture,
 * watermark, and one page per common conversion. Same shape as the entries in tools.ts.
 */
export const IMAGE_EDIT_TOOLS: ToolDef[] = [
  {
    slug: "crop-image",
    kind: "image",
    name: "Crop image",
    short: "Cut a photo to a shape or size, or to a circle.",
    title: "Crop an image online: free shape, square, or circle",
    description: "Crop a JPG, PNG, or WebP by dragging a box, with square, 4:5, 16:9, and round presets. Runs in your browser, so the photo is never uploaded.",
    intro:
      "Drag a box over the part of the picture you want to keep. Choose free shape, a standard ratio such as 1:1 or 9:16, or a circle for profile pictures. The crop is cut from the full-size picture, not the preview, so no quality is lost. The photo never leaves your device.",
    icon: "image-crop",
    accent: "sky",
    keywords: ["crop image", "crop photo online", "circle crop", "crop picture to square", "image cropper"],
    steps: [
      { name: "Choose the picture", text: "Drop a JPG, PNG, WebP, AVIF, GIF, BMP, SVG, or HEIC file." },
      { name: "Drag the box", text: "Move the box and drag a corner to resize it. Pick a ratio to lock the shape, or tick Round for a circle." },
      { name: "Crop and download", text: "Save as JPG, PNG, or WebP. A circle crop is saved with transparent corners in PNG or WebP." },
    ],
    faqs: [
      {
        question: "Does cropping reduce quality?",
        answer: "The cut is taken from the original pixels, so the part you keep is not blurred or shrunk. A JPG output is saved once more as JPG; choose PNG for no further loss.",
      },
      {
        question: "How do I make a round profile picture?",
        answer: "Tick Round (circle) crop. The box becomes a square-locked circle and the picture is saved as a PNG with transparent corners.",
      },
      {
        question: "Which ratio should I use for Instagram?",
        answer: "1:1 for a classic post, 4:5 for the tallest feed post, and 9:16 for Stories and Reels covers.",
      },
    ],
    related: ["resize-image", "rotate-image", "compress-image"],
  },
  {
    slug: "rotate-image",
    kind: "image",
    name: "Rotate image",
    short: "Turn, flip, or straighten a photo.",
    title: "Rotate or flip an image online, no upload",
    description: "Rotate a photo 90, 180, or 270 degrees, mirror it, or straighten a crooked shot by a few degrees. Runs in your browser with no upload.",
    intro:
      "Fix a sideways photo, mirror a selfie, or level a crooked horizon. Choose a quarter turn, add a fine tilt of up to 45 degrees, and mirror it if you want. A quarter turn loses nothing. Your picture is processed on your device and never uploaded.",
    icon: "image-rotate",
    accent: "violet",
    keywords: ["rotate image", "flip image", "mirror image", "straighten photo", "rotate photo online"],
    steps: [
      { name: "Choose the picture", text: "Drop a JPG, PNG, WebP, AVIF, GIF, BMP, SVG, or HEIC file." },
      { name: "Turn it", text: "Pick a quarter turn, move the tilt slider to straighten, and add a mirror if needed. A small preview shows the result." },
      { name: "Save", text: "Download JPG, PNG, or WebP. A tilted picture is a little bigger, because the corners need room." },
    ],
    faqs: [
      {
        question: "Why does my photo look sideways?",
        answer: "Phones store photos unturned with a note saying how to rotate them, and some programs ignore the note. Rotating the picture here writes the right orientation into the pixels.",
      },
      {
        question: "What happens to the corners when I tilt a photo?",
        answer: "A tilted picture needs a larger frame. The empty corners are transparent in PNG and WebP, or filled with a colour you choose in JPG. Crop it afterwards to trim them.",
      },
      {
        question: "Is a rotation lossless?",
        answer: "A 90, 180, or 270 degree turn moves pixels without changing them. A fine tilt re-samples the picture once, and a JPG is saved again.",
      },
    ],
    related: ["crop-image", "resize-image", "convert-image"],
  },
  {
    slug: "remove-photo-metadata",
    kind: "image",
    name: "Remove photo metadata",
    short: "See and remove location and camera data from a photo.",
    title: "Remove EXIF and location data from photos, no upload",
    description: "See the GPS location, camera, and date hidden in a photo, then remove them without re-encoding the picture. Runs in your browser; nothing is uploaded.",
    intro:
      "Photos carry hidden data: where they were taken, which phone took them, and when. Cutmoor shows you what is inside before you share a photo, then cuts it out of the file without touching the picture. JPG, PNG, and WebP are cleaned in place with no quality loss. Everything happens on your device.",
    icon: "privacy",
    accent: "mint",
    keywords: ["remove exif data", "remove location from photo", "strip photo metadata", "remove gps from image", "exif remover"],
    steps: [
      { name: "Choose the photo", text: "Drop a photo from a phone or camera. The tool reads it on your device and lists what is hidden in it." },
      { name: "Check what was found", text: "You see the camera or phone, the date, any serial number, and the GPS position if there is one." },
      { name: "Remove and save", text: "Cutmoor writes a clean copy. A colour profile is kept, and a phone photo keeps its upright orientation." },
    ],
    faqs: [
      {
        question: "Does removing the data change the picture?",
        answer: "For JPG, PNG, and WebP, no. The picture is not decoded or re-encoded: only the metadata blocks are cut out of the file, so every pixel stays exactly the same.",
      },
      {
        question: "What about HEIC, AVIF, and GIF?",
        answer: "Those formats cannot be cleaned in place here, so the picture is redrawn as a JPG or PNG, which carries none of the original file's hidden data. It is re-encoded once.",
      },
      {
        question: "Do social networks remove this data?",
        answer: "Many do when you upload, but not all, and not when you send the original file in a chat or email. Cleaning it yourself first means you do not have to rely on that.",
      },
      {
        question: "Why is the orientation kept?",
        answer: "Phones often save a photo sideways and record the turn in the metadata. Removing it all would make the photo appear rotated, so only that one number is kept.",
      },
    ],
    related: ["compress-image", "convert-image", "blur-image"],
  },
  {
    slug: "blur-image",
    kind: "image",
    name: "Blur or hide part of an image",
    short: "Pixelate, blur, or black out faces, plates, and text.",
    title: "Blur faces and hide text in a photo, no upload",
    description: "Draw over faces, number plates, or private text and blur, pixelate, or black them out. The photo is edited on your device and never uploaded.",
    intro:
      "Hide what should not be seen before you share a picture. Drag over each area, choose pixelate, blur, or a solid black box, and Cutmoor edits the full-size picture on your device. It is a good fit for a tool that never uploads: the picture you are hiding something in never leaves your computer.",
    icon: "blur",
    accent: "rose",
    keywords: ["blur face in photo", "pixelate image", "hide text in screenshot", "blur license plate", "censor image online"],
    steps: [
      { name: "Choose the picture", text: "Drop a JPG, PNG, WebP, AVIF, GIF, BMP, SVG, or HEIC file." },
      { name: "Mark what to hide", text: "Drag over each face, plate, or line of text. Undo the last box or clear them all." },
      { name: "Pick how to hide it", text: "Pixelate, blur, or Black box, with a strength slider. Save as JPG, PNG, or WebP." },
    ],
    faqs: [
      {
        question: "Is a blur safe for hiding a password or an ID number?",
        answer: "A strong blur or pixelation hides detail from a glance, but a mild one on small text can sometimes be reversed. For anything that must never be read, use Black box: it replaces the pixels completely.",
      },
      {
        question: "Does it find faces automatically?",
        answer: "No. You mark each area yourself, which means nothing is guessed or uploaded to a recognition service.",
      },
      {
        question: "Is the edit done on the full-size picture?",
        answer: "Yes. The preview only helps you aim; the hiding is applied to the original pixels, so the result is full resolution.",
      },
    ],
    related: ["remove-photo-metadata", "crop-image", "watermark-image"],
  },
  {
    slug: "watermark-image",
    kind: "image",
    name: "Watermark image",
    short: "Stamp your name or logo on a picture.",
    title: "Add a watermark to an image online, no upload",
    description: "Add a text or logo watermark to a photo in your browser. Choose the position, size, and see-through level. Your picture is never uploaded.",
    intro:
      "Put your name, handle, or logo on a picture before you share it. Type text in any language or pick a logo, preview where it lands, and save the watermarked copy at full size. The text is drawn by your browser, so Hindi, Arabic, and emoji work. Nothing is uploaded.",
    icon: "image-watermark",
    accent: "gold",
    keywords: ["watermark image", "add watermark to photo", "add logo to image", "photo watermark online", "add text to image"],
    steps: [
      { name: "Choose the picture", text: "Drop a JPG, PNG, WebP, AVIF, GIF, BMP, SVG, or HEIC file." },
      { name: "Design the mark", text: "Type text or pick a logo, choose a corner or the centre, and set the size and how see-through it is." },
      { name: "Save", text: "Download the watermarked picture as JPG, PNG, or WebP at its full size." },
    ],
    faqs: [
      {
        question: "Can I use a logo with a transparent background?",
        answer: "Yes. A PNG with transparency is placed as it is, so only the logo shows over the picture.",
      },
      {
        question: "Will the watermark be removable?",
        answer: "It becomes part of the picture, so it cannot be switched off. Keep your original file.",
      },
      {
        question: "Does it work with non-English text?",
        answer: "Yes. Your browser draws the text with the fonts on your device, so any script your device can display works.",
      },
    ],
    related: ["watermark-video", "compress-image", "resize-image"],
  },
  {
    slug: "webp-to-jpg",
    kind: "image",
    name: "WebP to JPG",
    short: "Turn a WebP image into a JPG that opens everywhere.",
    title: "Convert WebP to JPG online, free and private",
    description: "Convert a WebP image to JPG in your browser with a quality slider. Transparent areas get a background colour you choose. No upload.",
    intro:
      "WebP files do not open in every app. Cutmoor converts a WebP to a standard JPG on your device: choose the quality, and pick the colour that fills any see-through areas, since JPG cannot be transparent. The file is never uploaded.",
    icon: "image-convert",
    accent: "peach",
    keywords: ["webp to jpg", "convert webp to jpg", "webp to jpeg", "webp converter", "open webp file"],
    steps: [
      { name: "Choose the WebP", text: "Drop a .webp file." },
      { name: "Set quality", text: "Pick JPG (or PNG to keep transparency) and a quality. 90 keeps a photo clean." },
      { name: "Download", text: "Save the converted file." },
    ],
    faqs: [
      {
        question: "Why will my WebP not open?",
        answer: "WebP is a web format. Many desktop programs, older phones, and some upload forms still reject it, while JPG works everywhere.",
      },
      {
        question: "What happens to transparency?",
        answer: "JPG has no transparency, so see-through areas are filled with the colour you choose, white by default. Choose PNG to keep them.",
      },
      {
        question: "Does the file get bigger?",
        answer: "Often yes. WebP is more efficient, so the same picture usually takes more bytes as a JPG. That is the price of compatibility.",
      },
    ],
    related: ["convert-image", "png-to-jpg", "compress-image"],
  },
  {
    slug: "png-to-jpg",
    kind: "image",
    name: "PNG to JPG",
    short: "Make a PNG into a smaller JPG.",
    title: "Convert PNG to JPG online, free and private",
    description: "Convert a PNG to a smaller JPG in your browser. Choose the quality and the colour behind transparent areas. No upload, no watermark.",
    intro:
      "A PNG screenshot or photo can be many times larger than the same picture as a JPG. Cutmoor converts it on your device, with a quality slider and a colour for any transparent areas. Your picture is never uploaded.",
    icon: "image-convert",
    accent: "lime",
    keywords: ["png to jpg", "convert png to jpg", "png to jpeg", "png converter", "reduce png size"],
    steps: [
      { name: "Choose the PNG", text: "Drop a .png file." },
      { name: "Set quality and background", text: "Pick the quality and the colour that fills transparent areas." },
      { name: "Download", text: "Save the JPG." },
    ],
    faqs: [
      {
        question: "Why is the JPG smaller?",
        answer: "PNG stores every pixel exactly. JPG throws away detail the eye barely notices, which makes photos far smaller. Flat graphics and text can show slight fuzziness at low quality.",
      },
      {
        question: "Should I convert a logo to JPG?",
        answer: "Usually not. Logos, icons, and screenshots with text look sharper as PNG, and JPG cannot keep transparency.",
      },
      {
        question: "What quality should I choose?",
        answer: "90 for photos you will keep, 75 for the web, and not below 60 where there are smooth gradients.",
      },
    ],
    related: ["compress-image", "jpg-to-png", "convert-image"],
  },
  {
    slug: "jpg-to-png",
    kind: "image",
    name: "JPG to PNG",
    short: "Save a JPG as a lossless PNG.",
    title: "Convert JPG to PNG online, free and private",
    description: "Convert a JPG to a lossless PNG in your browser. No upload, no account. Note that PNG cannot restore detail a JPG already lost.",
    intro:
      "Some tools and print workflows want a PNG. Cutmoor converts a JPG to PNG on your device without any further loss. It cannot bring back detail the JPG already threw away, and the PNG will usually be larger. The picture is never uploaded.",
    icon: "image-convert",
    accent: "mint",
    keywords: ["jpg to png", "convert jpg to png", "jpeg to png", "jpg to png converter", "make png from jpg"],
    steps: [
      { name: "Choose the JPG", text: "Drop a .jpg or .jpeg file." },
      { name: "Convert", text: "PNG is selected. Choose WebP instead if you want a smaller lossless-style file." },
      { name: "Download", text: "Save the PNG." },
    ],
    faqs: [
      {
        question: "Will the PNG look better than the JPG?",
        answer: "No. A PNG stores what it is given exactly, but the JPG's lost detail cannot return. The benefit is that no more is lost when you edit and save again.",
      },
      {
        question: "Why is the PNG so much bigger?",
        answer: "PNG does not discard detail, so photographic pictures take many times the bytes of a JPG.",
      },
      {
        question: "Can I get a transparent background this way?",
        answer: "No. A JPG has no transparency, so the PNG has none either. Removing a background needs a different tool.",
      },
    ],
    related: ["convert-image", "png-to-jpg", "resize-image"],
  },
  {
    slug: "svg-to-png",
    kind: "image",
    name: "SVG to PNG",
    short: "Turn a vector SVG into a PNG picture.",
    title: "Convert SVG to PNG online, free and private",
    description: "Convert an SVG vector file to a PNG in your browser. The SVG is drawn at its own size and keeps transparency. No upload.",
    intro:
      "Many sites and apps do not take SVG. Cutmoor draws your SVG on your device and saves it as a PNG with a transparent background. It uses the size the SVG declares, so for a larger PNG, give the SVG a bigger width and height first. Nothing is uploaded.",
    icon: "image-convert",
    accent: "sky",
    keywords: ["svg to png", "convert svg to png", "svg to image", "svg converter", "vector to png"],
    steps: [
      { name: "Choose the SVG", text: "Drop a .svg file." },
      { name: "Convert", text: "PNG is selected and keeps transparency. JPG fills it with a colour." },
      { name: "Download", text: "Save the PNG." },
    ],
    faqs: [
      {
        question: "How big will the PNG be?",
        answer: "As big as the SVG says it is (its width and height). To get a larger PNG, edit those values in the SVG, or resize the PNG afterwards with Resize image.",
      },
      {
        question: "Does it keep the transparent background?",
        answer: "Yes, as a PNG. Choosing JPG fills it with the colour you pick.",
      },
      {
        question: "Why does my SVG look wrong?",
        answer: "The browser draws SVG with its own engine. Files that depend on external fonts or linked images may not show them, because nothing is fetched.",
      },
    ],
    related: ["resize-image", "convert-image", "compress-image"],
  },
  {
    slug: "avif-to-jpg",
    kind: "image",
    name: "AVIF to JPG",
    short: "Turn an AVIF image into a JPG that opens everywhere.",
    title: "Convert AVIF to JPG online, free and private",
    description: "Convert an AVIF image to JPG in your browser with a quality slider. Needs a browser that can show AVIF. No upload, no account.",
    intro:
      "AVIF is very efficient but many programs cannot open it. Cutmoor converts an AVIF to a JPG on your device when your browser can display AVIF, which current Chrome, Edge, and Firefox can. The file is never uploaded.",
    icon: "image-convert",
    accent: "violet",
    keywords: ["avif to jpg", "convert avif to jpg", "avif to jpeg", "avif converter", "open avif file"],
    steps: [
      { name: "Choose the AVIF", text: "Drop a .avif file. If your browser cannot show AVIF, the tool tells you." },
      { name: "Set quality", text: "Pick JPG (or PNG) and a quality." },
      { name: "Download", text: "Save the converted file." },
    ],
    faqs: [
      {
        question: "Why does it say my browser cannot read the file?",
        answer: "The conversion uses your browser's own AVIF decoder. Older browsers do not have one. Try current Chrome, Edge, or Firefox.",
      },
      {
        question: "Will the JPG be larger?",
        answer: "Usually yes. AVIF is more efficient, so the same picture takes more bytes as a JPG.",
      },
      {
        question: "Does it keep transparency?",
        answer: "Choose PNG to keep it. JPG has no transparency, so see-through areas get a background colour.",
      },
    ],
    related: ["convert-image", "webp-to-jpg", "compress-image"],
  },
];
