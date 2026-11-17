import type { GuideBody } from "../../types";

export const body: GuideBody = {
  "sections": [
    {
      "heading": "The short version",
      "paragraphs": [
        "Merging means playing clips back to back in one file. A player can only show one picture size, one frame rate, and one sound format per file, so every clip has to be brought to the same shape before it is joined. That is why a merge re-encodes, and why it takes longer than a copy.",
        "Put the clips in order, pick the picture size, and export one MP4. If the clips came from the same phone in the same orientation, there is nothing else to decide."
      ]
    },
    {
      "heading": "When the clips do not match",
      "paragraphs": [
        "Mixed clips are the normal case: a vertical phone video, a horizontal screen recording, a square clip saved from a chat. Each one is scaled to fit inside the frame you chose and centred. Where its shape differs, black bars fill the gap. Nothing is stretched, so faces stay the right shape."
      ],
      "table": {
        "headers": [
          "Your clips",
          "Best picture size",
          "What you will see"
        ],
        "rows": [
          [
            "All horizontal",
            "1080p or 720p wide",
            "Full frame, no bars"
          ],
          [
            "All vertical",
            "Vertical 9:16",
            "Full frame, no bars"
          ],
          [
            "Mixed",
            "Match the most important clip",
            "Bars on the clips of the other shape"
          ],
          [
            "For a square feed",
            "Square",
            "Bars top and bottom, or left and right"
          ]
        ],
        "caption": "Choose the shape of the place the video will be watched, not the shape of the first clip you happened to add."
      }
    },
    {
      "heading": "Keeping the sound in step",
      "paragraphs": [
        "A clip with no sound track is the most common cause of a merge where the voices drift out of time. If the silent clip adds picture but no audio, every later sound starts too early.",
        "Cutmoor checks each clip first. A clip without sound gets a stretch of silence exactly as long as its picture, so the sound of the following clips starts where it should."
      ],
      "callout": "If the result has a jump or a repeated second at a join, trim a few frames off the end of the earlier clip and merge again. Phone recordings often end on a half-finished frame."
    },
    {
      "heading": "Step by step",
      "paragraphs": [
        "The whole job runs on your device, so the clips are never uploaded."
      ],
      "bullets": [
        "Open Merge videos and choose two or more clips, up to ten.",
        "Use the arrows to put them in the order they should play.",
        "Pick the picture size: match the first clip, or choose 1080p, 720p, vertical, or square.",
        "Press Merge and wait. Long or high-resolution clips take longer because every frame is re-encoded.",
        "Download the MP4. If it is too large to send, run it through Compress video."
      ]
    },
    {
      "heading": "Limits worth knowing",
      "paragraphs": [
        "Everything is held in the memory of your browser while it is joined. Ten clips is the limit, and very long or 4K clips can run out of memory on a phone. Merge in two rounds if you have more, or lower the picture size.",
        "The output is always 30 frames per second with H.264 video and AAC sound, which plays everywhere. A 60 frames per second source is reduced to 30."
      ]
    }
  ],
  "faqs": [
    {
      "question": "Does merging videos reduce quality?",
      "answer": "A little, because every clip is re-encoded once so they can share one file. The setting used keeps the loss small. Avoid merging the same footage several times in a row."
    },
    {
      "question": "Can I merge videos of different formats, such as MOV and MP4?",
      "answer": "Yes. The container does not matter, because each clip is decoded and re-encoded. MP4 clips are verified; MOV, MKV, AVI, and WebM use the same decoder."
    },
    {
      "question": "Why is there a black bar on some clips?",
      "answer": "That clip has a different shape from the frame you chose. Bars keep the whole picture visible without stretching it. Crop the clip to the shape of the frame first if you want it to fill the screen."
    }
  ]
};
