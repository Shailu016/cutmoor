import type { GuideBody } from "../../types";

export const body: GuideBody = {
  sections: [
    {
      heading: "The short version",
      paragraphs: [
        "Open the Auto captions tool, drop in a video, pick a model, and wait while your browser listens to the audio and writes the words down. You then fix mistakes in an editor, preview the captions over the video, and export a subtitle file (SRT or VTT) or a new MP4 with the captions burned in.",
        "The difference from most caption sites is where the work happens. Your video is not sent anywhere. The first time you use the tool, your browser downloads a speech-recognition model, keeps it, and runs it locally. We never receive your media.",
      ],
    },
    {
      heading: "What happens to your video",
      paragraphs: [
        "Captioning has two heavy steps: reading the audio out of the video, and turning speech into text. In this tool both run inside the page on your device. The video file is read by your browser, the sound is converted to a plain stream of audio samples in memory, and a model works through it in short pieces.",
        "The only thing that crosses the network is the model and the small runtime files it needs. They come from models.cutmoor.com, our own storage, and download once after you agree. Each file is checked against a SHA-256 fingerprint that ships with the site, then stored in your browser. The host can see ordinary request details such as your IP address and browser, and which file you asked for. It cannot see your video, audio, or transcript, because none of them are ever sent.",
      ],
      callout:
        "You can check this yourself. Open your browser's developer tools, go to the Network tab, run a video, and look for any request that carries data out. After the model is cached there should be nothing to see.",
    },
    {
      heading: "Step by step",
      paragraphs: [
        "The steps below follow the order of the tool. Allow a few minutes for the first run, mostly for the model download.",
      ],
      bullets: [
        "Add the video. Drop a file on the tool or choose it from your device. MP4 and MOV from a phone are the most common.",
        "Choose a model. Draft is about 160 MB and is a quick first pass for clear speech. High accuracy is about 800 MB, needs WebGPU, and is the accurate one, so it is for a recent Chrome or Edge on a computer.",
        "Approve the model download. The first time, the tool shows the size and the host and waits for you. On a phone, use Wi-Fi if you can.",
        "Wait for the captions. The tool shows which stage it is in. Captions appear as they are found, so you can start reading before the end.",
        "Edit. Click a word to correct it, and adjust timing where a caption comes in early or late.",
        "Preview. Play the video with the captions over it. The word being spoken is highlighted.",
        "Export. Download SRT or VTT for a platform that takes subtitle files, or burn the captions into a new MP4.",
      ],
    },
    {
      heading: "Choose Draft or High accuracy",
      paragraphs: [
        "Before the first run you choose between two speech models. Draft is the smaller one, about 160 MB. It is a quick first pass for clear speech from one person: it starts sooner, uses less memory, and works in more browsers, but it can miss words on fast, noisy or accented speech.",
        "High accuracy is about 800 MB. It is a much larger model and is clearly better on fast, noisy, or children's speech, but it needs WebGPU, which means a recent Chrome or Edge on a computer. It is aimed at a desktop or laptop. A phone may run out of memory with this model.",
        "Each model downloads once, separately, after you agree. If you use only one of them, you only download that one.",
      ],
    },
    {
      heading: "Hinglish, Hindi and English",
      paragraphs: [
        "Many people speak Hindi and English in the same sentence and write it in Roman letters, which is what Hinglish means here. That is hard for tools built for one language at a time, which tend to either force every word into one script or give up on the English words.",
        "The tool is built for that mix and writes the result in Roman letters. It reads Hindi or English speech the same way, so there is no language setting to pick. Spelling in Roman Hindi is not standardised, so the same word can be written in several valid ways. The tool makes common spellings consistent across the transcript, but it cannot know names. Put those in the Names and special words box before or after the run, and check them in the editor.",
      ],
    },
    {
      heading: "How accurate is it?",
      paragraphs: [
        "We are not going to give you a percentage, because it would depend on a recording we have never heard. What we can say is what makes it better or worse.",
        "Songs, rap, and speech over loud music are a known weak spot: where there is singing, music behind or under the voice gives more wrong words and some missing lines, and a song takes longer. It cannot make out every sung line: dense choruses and lines buried in music are the first to go, and it leaves a gap there instead of filling it with guessed words. If you have the lyrics, paste them in the Lyrics or script box and the tool will fit your words to the audio. If the recording is fast, noisy, or has children speaking, High accuracy is much better than Draft.",
      ],
      table: {
        headers: ["Helps", "Hurts"],
        rows: [
          ["One clear speaker close to the microphone", "Several people talking over each other"],
          ["Quiet room, steady volume", "Music, traffic, or crowd noise under the voice"],
          ["Normal speaking pace", "Very fast speech, shouting, or mumbling"],
          ["Adult voices", "Children's speech, especially with the Draft model"],
          ["Common words", "Names, brands, and technical terms, which are often misspelled"],
        ],
        caption: "Treat the output as a good first draft. Read it against the audio once before you publish.",
      },
    },
    {
      heading: "Fix the mistakes before you export",
      paragraphs: [
        "Speech recognition can write words that were never said, especially over silence or music, and it can miss quiet words. The tool tries to catch some of this and skips stretches it does not trust, but it cannot catch everything. A caption that is wrong in a published video is worse than no caption, so read through once with the sound on.",
        "Word timing comes from the model and can be off by a fraction of a second, so check the highlight when a word starts. In the editor you can change a word, split or merge words, move timing, and delete a caption that should not be there. Undo and redo are available, so it is safe to try things. Names and brand spellings are the usual fixes; correct them once and check the other places they appear.",
      ],
    },
    {
      heading: "SRT, VTT or burned-in captions?",
      paragraphs: [
        "A subtitle file is a separate text file with timing. The viewer can turn it on or off, and you can edit it later. Burned-in captions are drawn into the picture of a new video, so they show everywhere but cannot be switched off or edited afterwards.",
      ],
      bullets: [
        "Use VTT for web video players and most websites.",
        "Use SRT for YouTube uploads, desktop editors, and older players. If you need to go from one to the other, the subtitle converter on this site does it.",
        "Burn in captions for short vertical videos, where viewers watch without sound and the platform's own caption styling would be missing or inconsistent.",
      ],
    },
    {
      heading: "Limits to know about",
      paragraphs: [
        "Everything runs on your device, so your device sets the limits. A long video on an older phone takes longer and can run out of memory, and the tool will tell you if it cannot finish rather than pretending it did. Close other tabs first. If a file is very long, split it into parts and caption each one.",
        "So far the tool has been verified only in desktop Chrome on Windows. Other browsers and phones have not been tested for this release, and a phone may run out of memory with High accuracy. Burned-in export also depends on your browser's video encoder, so it works in some browsers and not others.",
        "The first run needs a connection for the model download. After the model is cached, captioning itself does not need the network, but we do not promise the page works with no connection at all, so do not rely on it as an offline tool.",
      ],
    },
    {
      heading: "Deleting the model",
      paragraphs: [
        "The cached model takes up space on your device. Draft is about 160 MB and High accuracy is about 800 MB, so together they can be large. The tool has a Delete model button, and clearing this site's data in your browser settings removes them too. If you delete a model, the next time you choose it the tool will ask before downloading it again.",
      ],
    },
  ],
  faqs: [
    {
      question: "Is my video uploaded when I add captions?",
      answer:
        "No. The video is read and processed in your browser, and we never receive your media. The only download is the speech model you choose, fetched once from models.cutmoor.com and then kept by your browser.",
    },
    {
      question: "Which model should I choose?",
      answer:
        "Use Draft, about 160 MB, for a quick first pass on clear speech from one person. It starts sooner and uses less memory. Use High accuracy, about 800 MB, for the accurate transcript on fast, noisy, or children's speech, but only on a computer with recent Chrome or Edge, because it needs WebGPU.",
    },
    {
      question: "Why does the tool download a model first?",
      answer:
        "Speech recognition needs a trained model, and it is a large file. Downloading it to your device is what lets the captioning run locally instead of on a server. The tool shows the size and asks before it downloads, checks the file against a known fingerprint, and caches it so later videos start faster.",
    },
    {
      question: "Does it work with Hinglish?",
      answer:
        "Yes. It is built for speech that mixes Hindi and English and writes it in Roman letters, and it reads Hindi or English speech the same way. Roman Hindi has no single correct spelling, so the tool makes common spellings consistent and leaves names to the Names and special words box. Expect to edit some words.",
    },
    {
      question: "How accurate are the captions?",
      answer:
        "It depends on the recording. Clear single-speaker audio does well; noise, overlapping voices, songs, and names do worse. We do not claim a fixed accuracy, so read the captions against the audio and fix errors before you publish.",
    },
    {
      question: "Can I paste the lyrics or a script?",
      answer:
        "Yes. Open the Lyrics or script box in the settings, under Names and special words, and paste the words exactly as they are spoken. The tool does not write the lyrics for you: it takes your words and works out only the timing, placing each line against the audio. Lines it cannot match are listed after the run and left out rather than forced in, and the text stays in your browser, never uploaded. Timing from your words is most precise with High accuracy.",
    },
    {
      question: "Why are some lines missing from a song?",
      answer:
        "The tool cannot make out some singing, especially choruses and lines over dense music, so a song captioned without lyrics can have gaps where it found no words. Pasting the lyrics is the remedy: you supply the words and the tool works out only the timing. It does not promise to find every line, and any line it cannot match is listed after the run and left out rather than forced into the audio.",
    },
    {
      question: "How accurate is the word timing?",
      answer:
        "Word timing comes from the model and can be off by a fraction of a second, so watch the highlight and nudge a word if it comes in early or late.",
    },
    {
      question: "Can I get an SRT or VTT file?",
      answer:
        "Yes. You can export SRT, VTT, or a word-level timing file, and you can also burn the captions into a new MP4 if your browser supports the video encoding it needs.",
    },
    {
      question: "Does it work on a phone?",
      answer:
        "Not reliably yet. The tool has been verified only in desktop Chrome on Windows. Phones are slower, have less memory, and may run out of memory with High accuracy. They have not been tested for this release.",
    },
    {
      question: "Does it work offline?",
      answer:
        "Not as a promise. You need a connection the first time to download the model. Once it is cached, the captioning step does not send your video anywhere, but we have not designed the page to be used with no connection.",
    },
    {
      question: "How do I remove the downloaded model?",
      answer:
        "Use the Delete model button in the tool, or clear this site's data in your browser settings. Each model is stored separately, and the next time you choose one it will ask before downloading it again.",
    },
  ],
};
