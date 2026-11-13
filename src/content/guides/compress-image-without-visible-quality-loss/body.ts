import type { GuideBody } from "../../types";

export const body: GuideBody = {
  sections: [
    {
      heading: "Why an image is large",
      paragraphs: [
        "An image file is a description of pixels. More pixels means more data, and a busier image compresses less efficiently than a plain one. A 4000 × 3000 photo contains 12 million pixels. At three bytes per pixel before compression, that is 36 MB of raw data; a good JPG encoder brings it down to a few megabytes by discarding detail the eye is unlikely to notice.",
        "That gives you two levers: the number of pixels and the amount of detail kept per pixel. Most people reach for the quality slider first. The bigger saving is usually the dimensions. If an image will be displayed at 1200 px wide, storing it at 4000 px is wasted space in every direction.",
      ],
      callout:
        "Resize to the largest size the image will actually be displayed at, then compress. Doing it in the other order throws away quality you could have kept.",
    },
    {
      heading: "The quality slider is not linear",
      paragraphs: [
        "JPEG quality is an encoder setting, not a percentage of visible quality. The file size falls quickly as you move from 95 to 85, then more slowly. The visible difference between 90 and 80 is often negligible on a photo. The difference between 80 and 60 is usually obvious in gradients, skin, and fine texture.",
        "For photographs, 80–88 is a sensible range. For images with text, sharp edges, or large flat areas, JPG is the wrong format and no quality setting will fully hide the artifacts. Use PNG for those instead.",
      ],
      table: {
        headers: ["Quality", "Typical visual result", "When to use"],
        rows: [
          ["90–95", "Very clean; large file", "Print, archival delivery, high-value hero images"],
          ["80–88", "Clean at normal viewing size", "Most web and social images"],
          ["70–79", "Slight softening; acceptable for thumbnails", "Small previews, email, tight size limits"],
          ["50–69", "Visible artifacts in gradients and detail", "Last resort when the target is extremely small"],
          ["Below 50", "Blocking, banding, colour shifts", "Avoid for anything a person will inspect"],
        ],
        caption:
          "Numbers are a starting point. Always check the result at 100 percent and at the size it will be viewed.",
      },
    },
    {
      heading: "Target-size compression, explained",
      paragraphs: [
        "A target size is a constraint, not a setting. To hit it, the tool has to search. For JPG and WebP, Cutmoor encodes the image at several quality levels and narrows in on the highest one that stays under the target. If even the lowest sensible quality is too large, it reduces the dimensions in steps and tries again.",
        "That is why a target-size result sometimes says the output was reduced to a smaller size. It is not a failure; it is the honest way to meet the constraint. The alternative, returning a file over the target and calling it done, would be worse.",
        "PNG is lossless, so the quality slider does not apply. A PNG can only reach a target by reducing dimensions or by using a palette. For photographs, converting to JPG or WebP is usually the better move.",
      ],
      bullets: [
        "A 200 KB target is comfortable for a 1080 px photo.",
        "A 50 KB target at full resolution will show damage; reduce dimensions first.",
        "A 1 MB target is generous for a web hero image and usually easy to hit.",
        "If the result is still over target, the tool should say so, not silently label it as success.",
      ],
    },
    {
      heading: "Screenshots, graphics, and transparency",
      paragraphs: [
        "Screenshots are mostly text and flat colour. JPG is a poor fit: the artifacts appear exactly where the eye is most sensitive, around letters and interface edges. PNG keeps them crisp and often compresses the flat areas well. If a screenshot is 3 MB, the first question is whether it needs to be that large, not whether the quality can go lower.",
        "For graphics with transparency, PNG or WebP are the only options that preserve the alpha channel. JPG will fill transparent pixels with a solid colour. If the destination requires JPG, choose the fill colour deliberately instead of accepting white by default.",
      ],
      table: {
        headers: ["Image type", "Best format", "Recommended move"],
        rows: [
          ["Phone photo", "JPG or WebP", "Cap the long edge at 1600–2048 px, quality 80–86"],
          ["Screenshot with text", "PNG", "Keep lossless; crop unnecessary areas"],
          ["Logo with transparency", "PNG or WebP", "Keep lossless; export at display size"],
          ["Product photo on white", "JPG", "Resize to 1600 px, quality 85"],
          ["Detailed artwork", "WebP or PNG", "Prefer lossless if the file size is acceptable"],
        ],
      },
    },
    {
      heading: "A workflow that protects quality",
      paragraphs: [
        "The safest compression workflow is boring and repeatable. It also takes less than a minute per image once the dimensions are known.",
      ],
      bullets: [
        "Keep the original file. Work on a copy, and never overwrite the only version.",
        "Crop to the final aspect ratio before resizing.",
        "Resize to the largest display size, not to the source size.",
        "Choose the format based on content: JPG for photos, PNG for text and transparency.",
        "Use a target size or a quality around 82–88, not 100.",
        "Inspect the result at 100 percent, then at the size it will appear on screen.",
        "If it looks soft, raise the quality slightly or reduce the dimensions further. Do not sharpen a badly compressed file.",
      ],
    },
    {
      heading: "Common mistakes",
      paragraphs: [
        "Most compression problems are self-inflicted, and most are reversible if the original is kept.",
      ],
      bullets: [
        "Compressing an already compressed file repeatedly, adding a generation of loss each time.",
        "Uploading a 6000 px image when the page displays it at 1200 px.",
        "Using JPG for screenshots and then blaming the tool for fuzzy text.",
        "Setting quality to 100 and wondering why the file is still large.",
        "Converting a photo to PNG because PNG sounds lossless, then uploading a 20 MB file.",
        "Judging the result on a phone preview that has already been scaled down.",
      ],
      callout:
        "If the file must be under a hard limit, reduce dimensions first and quality second. The result usually looks better than crushing quality at full resolution.",
    },
  ],
  faqs: [
    {
      question: "Can I compress an image without losing any quality?",
      answer:
        "Only if the format is lossless and the file was not already compressed lossily. PNG and lossless WebP can be re-encoded without changing pixels, but the size reduction is limited. For photos, some loss is unavoidable when the file gets smaller; the goal is to keep it below the threshold where a person notices.",
    },
    {
      question: "What is the best image quality setting?",
      answer:
        "For JPG photos, 80–88 is a good range. 90–95 is useful for print or archival delivery. Below 70, artifacts become visible in gradients and fine detail. For PNG, quality does not apply because the format is lossless.",
    },
    {
      question: "Why is my compressed image still large?",
      answer:
        "The dimensions are probably too high, or the content is very detailed. A 4000 px photo will stay large even at low quality. Reduce the long edge to the size it will be displayed at, then compress again.",
    },
    {
      question: "Should I compress before or after resizing?",
      answer:
        "Resize first, then compress. Resizing reduces the number of pixels the encoder has to describe, which usually saves more bytes than lowering quality. It also avoids compressing detail that will be thrown away.",
    },
    {
      question: "Does compressing an image remove EXIF data?",
      answer:
        "A canvas-based re-encode does, including GPS coordinates and camera details. If you need to preserve metadata, keep the original file and use a metadata-aware editor for the archive copy.",
    },
  ],
};
