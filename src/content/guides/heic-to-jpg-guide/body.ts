import type { GuideBody } from "../../types";

export const body: GuideBody = {
  sections: [
    {
      heading: "What HEIC actually is",
      paragraphs: [
        "HEIC is the still-image flavour of HEIF, a container format that can hold images encoded with HEVC (H.265) or other codecs. Apple adopted it with iOS 11 and macOS High Sierra, and iPhones have used it by default ever since. The appeal is efficiency: HEIC typically stores the same visual quality in roughly half the bytes of a comparable JPG.",
        "The name is slightly loose. Strictly, HEIC is the HEVC-coded variant, while HEIF is the container. A file may be labelled .heic or .heif and contain similar data. Apple uses both extensions depending on the device and the export path.",
      ],
      callout:
        "HEIC is a container, not a single codec. That is why one HEIC file opens and another fails: the decoder may support the container but not the specific codec or profile inside it.",
    },
    {
      heading: "Why Windows, Android, and upload forms reject it",
      paragraphs: [
        "Compatibility is the whole problem. macOS and iOS can decode HEIC natively. Windows does not include a decoder by default on every edition, and many Android apps and web upload forms never added support. The file is valid; the software simply does not know what to do with it.",
        "A web browser makes this more confusing. Safari on Apple platforms can decode HEIC through the operating system. Chrome, Edge, and Firefox generally cannot, so a photo that opens fine in the iPhone Photos app will show a broken image or a generic error when selected in a browser on Windows.",
      ],
      bullets: [
        "Windows may need the HEIF Image Extensions package, and even then app support varies.",
        "Android support depends on the manufacturer and the app, not just the OS version.",
        "Many job portals, government forms, and email clients still accept only JPG or PNG.",
        "Social platforms often accept HEIC from the iPhone app but reject it from a desktop browser.",
      ],
    },
    {
      heading: "Five ways to convert, ranked by privacy",
      paragraphs: [
        "The conversion itself is simple. The difference between methods is where the photo goes and how much control you have over quality and metadata.",
      ],
      table: {
        headers: ["Method", "Where the photo goes", "Quality control", "Best for"],
        rows: [
          ["iPhone Settings → Camera → Formats → Most Compatible", "Nowhere; future photos are captured as JPG", "Full camera quality", "Preventing the problem before it starts"],
          ["Share sheet → Save to Files / Mail", "Nowhere, but export options are limited", "Usually full quality", "A few photos on the phone"],
          ["Photos app on Mac → Export", "Nowhere", "Good; choose JPEG quality", "Mac users with a library"],
          ["Browser converter such as Cutmoor", "Stays in the browser tab", "Quality slider and preview", "Windows, Android, Chromebooks, cross-platform"],
          ["Upload-and-download website", "Uploaded to an unknown server", "Varies", "Avoid for personal photos"],
        ],
        caption:
          "A local converter is not automatically trustworthy. Check whether the page uploads the file or processes it in the browser.",
      },
    },
    {
      heading: "What happens to quality",
      paragraphs: [
        "Converting HEIC to JPG is a lossy-to-lossy transcode. The HEIC decoder reconstructs the pixels, then the JPG encoder compresses them again. A high-quality JPG (around 90) is visually clean for sharing and normal printing, but it is another generation of compression and the file will usually be larger than the HEIC original.",
        "HEIC also supports 10-bit colour and HDR. A standard JPG is 8-bit SDR, so very bright highlights and wide-gamut colour may look flatter after conversion. For casual photos this is rarely noticeable. For HDR video frames or professional colour work, keep the original and use a colour-managed editor.",
      ],
      bullets: [
        "Export at quality 90 for a clean share or print copy.",
        "Expect the JPG to be larger than the HEIC; that is the cost of compatibility.",
        "Avoid converting the same photo repeatedly; each pass adds loss.",
        "Keep the HEIC original if you may need HDR or the full metadata later.",
      ],
    },
    {
      heading: "Metadata, GPS, and orientation",
      paragraphs: [
        "HEIC files can carry EXIF metadata including GPS coordinates, camera model, lens, exposure, and capture time. A canvas-based conversion redraws the image and re-encodes it, so most of that metadata is not copied. That is usually good for privacy: sharing a photo of your home should not also share its coordinates.",
        "Orientation is handled differently. The decoder applies the stored rotation to the pixels, so the JPG appears upright even though the metadata is gone. This is the correct behaviour; a file that relied on an orientation tag and then lost the tag would appear sideways.",
        "If you need to preserve metadata for an archive, do not use a quick web converter. Use an editor or a command-line tool that copies EXIF deliberately, and check the result before deleting the original.",
      ],
    },
    {
      heading: "Troubleshooting a HEIC that will not convert",
      paragraphs: [
        "Most failures fall into a few categories. The file may not be HEIC at all, may contain more than one image, or may use a codec profile the decoder does not support.",
      ],
      bullets: [
        "Live Photos contain a still image and a short video. Export the still as a separate JPEG from Photos.",
        "Burst photos are a group of images; select the frame you want and export it individually.",
        "Some 10-bit HDR or ProRAW-adjacent files use profiles that a browser decoder may not handle.",
        "A file with a .heic extension can actually be AVIF or another ISO media format. Check the file header if a converter rejects it.",
        "If the browser runs out of memory, close other tabs and try one photo at a time.",
      ],
      callout:
        "On an iPhone, the most reliable fallback is Photos → Share → Copy Photo, then paste into an app that can export JPEG. It is slower, but it uses Apple's own decoder.",
    },
    {
      heading: "HEIC vs JPG vs PNG vs WebP",
      paragraphs: [
        "HEIC wins on size for Apple photos. JPG wins on compatibility. PNG wins on lossless graphics and transparency. WebP wins on web delivery when the destination supports it. None of them is the right answer for every file.",
      ],
      table: {
        headers: ["Format", "Typical strength", "Typical weakness", "Best destination"],
        rows: [
          ["HEIC", "Small files, good quality, HDR support", "Poor compatibility outside Apple", "iPhone photo library and archive"],
          ["JPG", "Opens everywhere, small enough", "Lossy, no transparency", "Email, upload forms, social platforms"],
          ["PNG", "Lossless, transparency", "Large photo files", "Screenshots, logos, diagrams"],
          ["WebP", "Small web files, transparency", "Older editors may reject it", "Websites and modern browsers"],
        ],
      },
    },
  ],
  faqs: [
    {
      question: "Is it safe to convert HEIC to JPG online?",
      answer:
        "Only if the converter processes the file in your browser. A traditional upload-and-download site sends the photo to a server you do not control. Cutmoor decodes HEIC locally with the system decoder on Safari or a lazily loaded open-source decoder on other browsers, so the photo never leaves the device.",
    },
    {
      question: "Does converting HEIC to JPG reduce quality?",
      answer:
        "A little. HEIC is more efficient, so a high-quality JPG is usually larger and may lose some fine detail or HDR range. Exporting at quality 90 keeps the result clean for sharing and normal printing.",
    },
    {
      question: "Can I stop my iPhone from taking HEIC photos?",
      answer:
        "Yes. Open Settings → Camera → Formats and choose Most Compatible. New photos will be captured as JPG. Existing HEIC photos are not converted retroactively, so you still need to convert the ones you already have.",
    },
    {
      question: "Why does the converter fail on my HEIC file?",
      answer:
        "The file may be a Live Photo, a burst, a 10-bit HDR variant, or a HEIC container with a codec profile the decoder does not support. Try exporting the still from the iPhone Photos app first, then convert that copy.",
    },
    {
      question: "Does the JPG keep the GPS location?",
      answer:
        "No. A canvas-based conversion strips EXIF and GPS metadata and applies orientation to the pixels. That is usually desirable for privacy, but it also removes camera and copyright fields. Keep the original HEIC if you need the full metadata.",
    },
    {
      question: "Why is the JPG larger than the HEIC file?",
      answer:
        "HEIC compresses more efficiently than JPG. Converting for compatibility usually increases the file size even at high quality. If size is the priority and the destination accepts it, keep the HEIC or convert to WebP instead.",
    },
  ],
};
