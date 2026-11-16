#!/usr/bin/env python
"""Approximate Devanagari -> Roman transliteration for the Qwen3-ASR spike.

Qwen3-ASR answers Hindi in Devanagari, but our gold references (and our product)
are Roman Hinglish. This helper turns generated words into rough Roman spelling
so the gold scorer can estimate whether the WORDS are right even though the
script is wrong. It is a measurement aid, not a product component:

  * it is a plain consonant/vowel table, not a linguistic transliterator;
  * doubled vowels are folded (aa->a, ee->i, oo->u) to look more like Hinglish;
  * the project's own scorer is then run on the result, and its number is
    reported as "approximate", never as an official WER.

Words that are already Latin pass through unchanged. Punctuation is kept
attached so the scorer strips it the same way it does for real transcripts.

Usage:
  python scripts/eval/qwen3/transliterate.py <in-hyp.json> <out-hyp.json>
"""

from __future__ import annotations

import json
import re
import sys

DEVANAGARI = re.compile(r"[\u0900-\u097f]")

INDEPENDENT = {
    "अ": "a", "आ": "aa", "इ": "i", "ई": "ee", "उ": "u", "ऊ": "oo",
    "ऋ": "ri", "ॠ": "ri", "ऌ": "li", "ए": "e", "ऐ": "ai", "ओ": "o",
    "औ": "au", "ऑ": "o", "ऍ": "e", "ऎ": "e",
}
CONSONANTS = {
    "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "ng",
    "च": "ch", "छ": "chh", "ज": "j", "झ": "jh", "ञ": "n",
    "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n",
    "त": "t", "थ": "th", "द": "d", "ध": "dh", "न": "n",
    "प": "p", "फ": "ph", "ब": "b", "भ": "bh", "म": "m",
    "य": "y", "र": "r", "ल": "l", "व": "v", "श": "sh",
    "ष": "sh", "स": "s", "ह": "h", "ळ": "l",
    "क़": "q", "ख़": "kh", "ग़": "g", "ज़": "z", "ड़": "r",
    "ढ़": "rh", "फ़": "f", "य़": "y",
}
MATRAS = {
    "ा": "aa", "ि": "i", "ी": "ee", "ु": "u", "ू": "oo", "ृ": "ri",
    "े": "e", "ै": "ai", "ो": "o", "ौ": "au", "ॉ": "o", "ॅ": "e",
    "ॆ": "e", "ॊ": "o",
}
MARKS = {"ं": "n", "ँ": "n", "ः": "h", "़": "", "्": ""}
DIGITS = str.maketrans("०१२३४५६७८९", "0123456789")
VOWEL_FOLD = [("aa", "a"), ("ee", "i"), ("oo", "u"), ("ii", "i"), ("uu", "u")]


def transliterate_word(word: str) -> str:
    if not DEVANAGARI.search(word):
        return word
    out: list[str] = []
    i = 0
    chars = word.translate(DIGITS)
    while i < len(chars):
        ch = chars[i]
        if ch in CONSONANTS:
            out.append(CONSONANTS[ch])
            nxt = chars[i + 1] if i + 1 < len(chars) else ""
            if nxt == "्":
                i += 2
                continue
            if nxt in MATRAS:
                out.append(MATRAS[nxt])
                i += 2
                continue
            out.append("A")
            i += 1
            continue
        if ch in INDEPENDENT:
            out.append(INDEPENDENT[ch])
            i += 1
            continue
        if ch in MATRAS:
            out.append(MATRAS[ch])
            i += 1
            continue
        if ch in MARKS:
            out.append(MARKS[ch])
            i += 1
            continue
        # Danda, punctuation, Latin and anything else: keep as is.
        out.append(" " if ch == "।" else ch)
        i += 1
    text = "".join(out)
    # Word-final inherent "a" is usually silent in Hindi (पागल -> pagal, not pagala).
    # "A" marks an inherent vowel; only an "A" at a word edge is dropped.
    text = re.sub(r"A(?=$|[^A-Za-z])", "", text)
    text = text.replace("A", "a")
    for old, new in VOWEL_FOLD:
        text = text.replace(old, new)
    return text


def transliterate_text(text: str) -> str:
    return " ".join(transliterate_word(token) for token in text.split())


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    with open(argv[0], encoding="utf-8") as handle:
        payload = json.load(handle)
    for clip in payload["clips"].values():
        for word in clip["words"]:
            word["text"] = transliterate_word(word["text"])
    with open(argv[1], "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=1)
    print(f"wrote {argv[1]}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
