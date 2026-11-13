import type { GuideBody } from "../../types";

export const body: GuideBody = {
  sections: [
    {
      heading: "The short version",
      paragraphs: [
        "SRT is the oldest subtitle format still in daily use. It is plain text: a cue number, a start and end time, the caption, then a blank line. WebVTT is the web standard. It keeps the same basic shape, adds a required header, and supports positioning, styling, and regions.",
        "If the captions are going into an HTML5 video element, use VTT. If they are going to YouTube, a desktop editor, or a legacy player, SRT is usually accepted. Many tools read both, but they do not read them the same way.",
      ],
    },
    {
      heading: "Format differences that break converters",
      paragraphs: [
        "Most failed conversions come from four details: the header, the decimal separator, cue settings, and encoding.",
      ],
      table: {
        headers: ["Element", "SRT", "VTT"],
        rows: [
          ["File header", "None", "WEBVTT on the first line"],
          [
            "Timestamp",
            "00:00:01,000 --> 00:00:04,000",
            "00:00:01.000 --> 00:00:04.000",
          ],
          ["Cue number", "Required in practice", "Optional"],
          ["Position", "Not supported", "line:90% position:50% align:middle"],
          ["Comments", "Not standard", "NOTE blocks"],
        ],
        caption:
          "Commas become periods. That single change is the most common cause of a file that looks fine but will not load.",
      },
    },
    {
      heading: "Timestamps and cue settings",
      paragraphs: [
        "SRT timestamps always use HH:MM:SS,mmm. VTT uses HH:MM:SS.mmm and also accepts MM:SS.mmm when the hour is zero. Both allow an optional cue identifier on the line before the timestamp, but in SRT that line is effectively the cue number.",
        "VTT cue settings sit after the timestamp and before the caption text. Common examples:",
      ],
      bullets: [
        "line:90% places the cue near the bottom.",
        "position:50% align:middle centers it horizontally.",
        "size:80% limits the cue width.",
        "vertical:rl writes vertical text for some languages.",
      ],
      callout:
        "SRT has no standardized placement. Some older files use override tags such as {\\an8} to push a cue to the top, but support varies by player. Treat those tags as hints, not guaranteed layout.",
    },
    {
      heading: "Encoding and line endings",
      paragraphs: [
        "Save both formats as UTF-8. VTT requires UTF-8, and SRT players increasingly expect it. A file saved as Windows-1252 will turn curly quotes, dashes, and accented characters into symbols on another machine.",
        "Avoid a UTF-8 BOM unless you know the target player accepts it. Some web parsers treat the BOM as part of the WEBVTT signature and reject the file. Use LF or CRLF line endings; both are widely accepted, but keep the file consistent.",
        "If you receive a file with mojibake, open it using the original encoding, copy the text, and paste it into a fresh UTF-8 document. Do not run a blind search and replace on the damaged characters; that often makes the file harder to repair.",
        "Escape or replace characters that look like markup. In VTT, a literal ampersand should be written as &amp; and angle brackets as &lt; and &gt;. In SRT, most players tolerate raw text, but clean markup prevents surprises.",
      ],
    },
    {
      heading: "Manual conversion, step by step",
      paragraphs: [
        "A correct conversion is more than search and replace. Work through this order:",
      ],
      bullets: [
        "Open the SRT in a plain-text editor, not a word processor.",
        "Add WEBVTT as the first line, followed by a blank line.",
        "Replace the comma in every timestamp with a period. Do not touch commas in the caption text.",
        "Keep or remove cue numbers; VTT does not require them.",
        "Convert any positioning you need into VTT cue settings. SRT had nowhere to store it, so this is new work.",
        "Save as UTF-8, then open the file in a browser or validator and check sync at the start, middle, and end.",
      ],
    },
    {
      heading: "Checklist before you publish",
      paragraphs: [
        "A file can load and still be a bad viewing experience. Run this list before delivery.",
      ],
      bullets: [
        "Every cue has a start before its end.",
        "No cue is shorter than one second or longer than seven.",
        "Lines stay under about 42 characters, with two lines maximum.",
        "Reading speed stays around 15-20 characters per second.",
        "No overlapping cues unless the player supports them.",
        "The file name ends in .vtt and the MIME type is text/vtt when served.",
      ],
      callout:
        "Cue settings are not cosmetic. Captions at the default bottom position can sit under player controls or a social app's interface.",
    },
  ],
  faqs: [
    {
      question: "Can I rename an SRT file to VTT?",
      answer:
        "No. The header and timestamp separators are different, so most players will reject it. Convert the content, then change the extension.",
    },
    {
      question: "Does VTT support styling?",
      answer:
        "Yes, through cue settings, the ::cue pseudo-element in CSS, and STYLE blocks. Support varies by browser, so treat styling as an enhancement rather than a guarantee.",
    },
    {
      question: "Which format should I use for YouTube?",
      answer:
        "YouTube accepts SRT and VTT. SRT is the simplest upload; VTT is better if you need positioning for a web player.",
    },
    {
      question: "Why do accented characters show as symbols?",
      answer:
        "The file was saved in a legacy encoding such as Windows-1252. Re-save it as UTF-8 and check the text again.",
    },
    {
      question: "Do I need cue numbers in VTT?",
      answer:
        "No. They are optional identifiers. Keeping them can help when you debug a specific cue.",
    },
  ],
};
