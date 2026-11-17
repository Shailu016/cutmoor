import type { GuideBody } from "../../types";

export const body: GuideBody = {
  "sections": [
    {
      "heading": "Why you got a WebP",
      "paragraphs": [
        "WebP is a web format: sites use it because it is smaller than JPG and PNG at the same quality. Browsers show it without trouble, so you only notice when you save the image and try to use it somewhere else.",
        "Older editing programs, some phones, printing services, and many upload forms still refuse WebP. Converting it to JPG or PNG fixes that."
      ]
    },
    {
      "heading": "JPG or PNG",
      "paragraphs": [
        "The right target depends on what the picture is, not on the file you started with."
      ],
      "table": {
        "headers": [
          "The image is",
          "Convert to",
          "Why"
        ],
        "rows": [
          [
            "A photo",
            "JPG",
            "Small file, accepted everywhere"
          ],
          [
            "A logo or icon with a clear background",
            "PNG",
            "Keeps the transparency"
          ],
          [
            "A screenshot with text",
            "PNG",
            "Text edges stay sharp"
          ],
          [
            "A drawing with flat colours",
            "PNG",
            "No fuzzy edges"
          ],
          [
            "Anything you only need to upload quickly",
            "JPG",
            "Smallest and most compatible"
          ]
        ],
        "caption": "When in doubt for a photo, choose JPG at quality 90."
      }
    },
    {
      "heading": "Transparency and quality",
      "paragraphs": [
        "JPG cannot be see-through. A WebP with a transparent background gets a solid colour behind it when it becomes a JPG; white is the default and you can choose another. If the transparency matters, choose PNG.",
        "Most WebP files are already lossy. Converting to JPG compresses the picture a second time, so use a high quality setting to keep that second loss invisible. PNG adds no further loss, but the file is larger."
      ]
    },
    {
      "heading": "Step by step",
      "paragraphs": [
        "The conversion runs in your browser, so the image is never uploaded."
      ],
      "bullets": [
        "Open WebP to JPG and choose the .webp file.",
        "Keep JPG, or switch to PNG to keep transparency.",
        "For JPG, leave quality at 90 for photos and pick the background colour if the image is see-through.",
        "Press Convert and download the file."
      ],
      "callout": "Expect the JPG to be larger than the WebP. WebP is the more efficient format; you are trading bytes for compatibility."
    }
  ],
  "faqs": [
    {
      "question": "Does converting WebP to JPG lose quality?",
      "answer": "Slightly, because JPG compresses the picture again. At quality 90 the difference is not visible for normal photos. Choose PNG if you want no further loss."
    },
    {
      "question": "Why is my converted file bigger than the WebP?",
      "answer": "WebP stores the same picture in fewer bytes than JPG or PNG. A larger file after converting is expected and does not mean anything went wrong."
    },
    {
      "question": "Can I convert an animated WebP?",
      "answer": "Only its first frame is kept, because JPG and PNG are still images. Use a video or GIF tool for animation."
    }
  ]
};
