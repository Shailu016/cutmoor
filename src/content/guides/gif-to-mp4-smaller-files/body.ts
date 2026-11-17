import type { GuideBody } from "../../types";

export const body: GuideBody = {
  "sections": [
    {
      "heading": "Why GIFs are so large",
      "paragraphs": [
        "A GIF stores animation as a stack of pictures, each limited to 256 colours, with only simple savings between frames. Video formats such as H.264 store what changes from one frame to the next and describe motion directly. The same few seconds can take 8 MB as a GIF and under 1 MB as an MP4.",
        "The MP4 also looks better: full colour instead of 256, and no dotted shading in gradients."
      ]
    },
    {
      "heading": "When to convert",
      "paragraphs": [
        "Convert when the place you are posting accepts video, or when the GIF is too heavy to send."
      ],
      "table": {
        "headers": [
          "Where it goes",
          "Use",
          "Why"
        ],
        "rows": [
          [
            "Instagram, TikTok, YouTube Shorts",
            "MP4",
            "They do not accept GIF uploads"
          ],
          [
            "WhatsApp, Telegram, Discord",
            "MP4",
            "Smaller, and plays inline"
          ],
          [
            "A web page you control",
            "MP4",
            "Loads faster; set it to loop and mute"
          ],
          [
            "Email",
            "GIF",
            "Most mail apps do not play video inline"
          ],
          [
            "Forums and old chat tools",
            "GIF",
            "Often the only moving format allowed"
          ]
        ],
        "caption": "If a GIF must stay a GIF, compress it instead of converting it."
      }
    },
    {
      "heading": "What changes in the MP4",
      "paragraphs": [
        "Three things are different, and it helps to know them before you convert."
      ],
      "bullets": [
        "No transparency. MP4 cannot be see-through, so transparent areas become black.",
        "It plays once. Many sites loop short videos for you; for a file that repeats, loop it after converting.",
        "Even pixel sizes. H.264 needs even width and height, so an odd size loses one pixel."
      ]
    },
    {
      "heading": "Step by step",
      "paragraphs": [
        "The conversion runs in your browser, so the GIF is not uploaded."
      ],
      "bullets": [
        "Open GIF to MP4 and choose the GIF.",
        "Press Convert to MP4.",
        "Download the MP4 and check it plays.",
        "If you need it to repeat as a file, run the MP4 through Loop video."
      ],
      "callout": "Going the other way, from video to GIF, keep it under six seconds and 480 pixels wide. Length and width decide the size of a GIF far more than anything else."
    }
  ],
  "faqs": [
    {
      "question": "Is an MP4 always smaller than a GIF?",
      "answer": "Almost always, and usually by a lot. The rare exception is a tiny GIF of a few flat-colour frames, where the video overhead can make the MP4 slightly larger. Keep the GIF in that case."
    },
    {
      "question": "Does the MP4 have sound?",
      "answer": "No. GIFs have no sound, so the MP4 is silent. You can add music afterwards with Add music to video."
    },
    {
      "question": "Can I turn the MP4 back into a GIF?",
      "answer": "Yes, with a video to GIF conversion, but the GIF will again be large and limited to 256 colours. Keep the original GIF if you may need it."
    }
  ]
};
