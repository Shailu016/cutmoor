import type { GuideBody } from "../../types";

export const body: GuideBody = {
  sections: [
    {
      heading: "What a trim actually does",
      paragraphs: [
        "Every trimmed export is one of two operations. The tool can copy the compressed video stream and throw away the packets outside your range, or it can decode the frames, cut at the exact moment you chose, and encode a new stream. The first is fast and lossless. The second is slower and always changes the picture a little, even at high quality settings.",
        "That difference explains most surprises people hit: a clip that starts a second early, a file that looks softer after export, or a one-minute cut that takes longer than expected. None of it is random. It comes down to where the cut lands relative to keyframes.",
      ],
      callout:
        "Rule of thumb: copy when you need speed or an archive cut, re-encode when the exact frame matters.",
    },
    {
      heading: "Keyframes decide where a fast cut can land",
      paragraphs: [
        "Video compression does not store every frame in full. It stores keyframes, also called I-frames, and then a run of predicted frames that only describe what changed. A typical keyframe interval is one to ten seconds. Encoders such as x264 default to 250 frames, which is about 8.3 seconds at 30 fps.",
        "A stream copy can only start on a keyframe. Ask for 00:00:05.000 and the nearest keyframe might be at 4.2 seconds. The export will either start at 4.2 or pad the gap, depending on the tool. The picture is untouched, but the timing is not what you requested. If the first frame must be exact, a copy is the wrong tool.",
      ],
      bullets: [
        "Keyframe spacing is set by the encoder, not by the file extension.",
        "Long GOPs are efficient but make fast cuts coarser.",
        "Phone footage often uses short GOPs, so copy cuts land closer to the request.",
      ],
    },
    {
      heading: "Fast trim vs exact trim",
      paragraphs: [
        "Most editors hide this choice behind labels like fast, precise, or smart. The labels vary; the trade-off does not.",
      ],
      table: {
        headers: ["Method", "What happens", "Speed", "Quality", "Best for"],
        rows: [
          [
            "Stream copy",
            "Cuts at the nearest keyframe and copies compressed packets",
            "Seconds",
            "No loss",
            "Rough cuts, archives, long recordings",
          ],
          [
            "Exact re-encode",
            "Decodes and re-encodes from the requested frame",
            "Slower",
            "One generation of loss",
            "Frame-accurate clips, social posts",
          ],
          [
            "Smart cut",
            "Copies the middle, re-encodes the first and last GOP",
            "Moderate",
            "Minimal loss",
            "Editing workflows that need both",
          ],
        ],
        caption:
          "Stream copy is sometimes called trimming without re-encoding. Smart cuts are often the default in desktop editors.",
      },
    },
    {
      heading: "Step by step",
      paragraphs: [
        "A clean trim takes less than a minute once you know which mode you are using.",
      ],
      bullets: [
        "Load the file and set the in and out points. Write down the exact timecodes.",
        "Decide whether the first frame must be exact. If yes, choose exact trim. If no, choose stream copy.",
        "Keep the source resolution, frame rate, and rotation. A trim is not the place to resize.",
        "Export to MP4 with H.264 video and AAC audio unless the source uses another codec you need to preserve.",
        "Play the first and last two seconds. Check for a frozen frame, a black flash, or audio that starts late.",
        "Keep the original file until the export has been checked on a second device.",
      ],
    },
    {
      heading: "When quality is lost",
      paragraphs: [
        "A single re-encode at a sane setting is hard to see. H.264 at CRF 18 to 20 is visually near-lossless for most footage; CRF 23 is the common default and still good; CRF 28 starts to smooth skin, gradients, and fine grain. The damage comes from stacking generations: trim, then compress, then add captions, then resize, with a fresh encode each time.",
        "Other avoidable losses: exporting at a higher resolution than the source, forcing a frame rate change, and using a bitrate below what the content needs. A static interview survives 3 Mbps at 1080p. Fast motion, confetti, and water need far more.",
        "In a command-line tool, a stream copy looks like this: ffmpeg -ss 00:01:23.500 -i input.mp4 -t 12 -c copy output.mp4. Remove -c copy and the same command re-encodes, which makes the start frame accurate. In browser tools such as Cutmoor, the export dialog usually exposes the same choice as a speed or quality setting.",
      ],
    },
    {
      heading: "Common mistakes",
      paragraphs: [
        "Most bad trims are caused by a small set of habits. Fix these and the rest becomes predictable.",
      ],
      bullets: [
        "Assuming a fast cut is frame-accurate because the timeline shows the exact time.",
        "Re-encoding a file that only needed a copy, then compressing it again.",
        "Cutting inside the first or last keyframe interval and losing a second of usable footage.",
        "Trimming a variable frame rate phone clip and blaming the editor for audio drift.",
        "Exporting over the only copy of the original.",
        "Ignoring rotation metadata, which can leave a vertical clip sideways after a copy.",
      ],
    },
  ],
  faqs: [
    {
      question: "Does trimming a video reduce quality?",
      answer:
        "Only when the tool re-encodes. A stream copy keeps the original frames bit for bit. An exact trim re-encodes and loses a small amount, which is usually invisible at CRF 18 to 20 but adds up over repeated exports.",
    },
    {
      question: "Why does my trimmed clip start earlier than the time I set?",
      answer:
        "The cut snapped to the previous keyframe. Use exact trim, or set the in point a keyframe or two later if the tool only supports copy.",
    },
    {
      question: "Can I trim without re-encoding in a browser?",
      answer:
        "Sometimes. Browsers can copy some MP4 streams, but support depends on the codec and container. If the option is not offered, the tool is re-encoding.",
    },
    {
      question: "What is the best format for a trimmed clip?",
      answer:
        "MP4 with H.264 video and AAC audio is the safest choice. It plays nearly everywhere and is accepted by every major platform.",
    },
    {
      question: "Should I trim before or after compressing?",
      answer:
        "Trim first. Compressing footage you are about to delete wastes time and, if you export twice, adds an extra generation of loss.",
    },
  ],
};
