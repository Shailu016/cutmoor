# Caption eval harness

Scores a hypothesis transcript against a **clips manifest** and enforces the MVP quality limits.
No model is run, no media is opened and nothing is uploaded: this tool only measures words that
already exist. The scoring itself lives in `src/lib/captioning/eval/` (pure TypeScript, unit-tested);
`run.mjs` is argument parsing, file IO and the exit code.

## Quick start

```bash
# Score a hypothesis file. Writes eval-results.json and prints a table.
node scripts/eval/run.mjs \
  --clips scripts/eval/example/clips.json \
  --hypothesis scripts/eval/example/hypothesis.json \
  --thresholds scripts/eval/example/thresholds.json \
  --out /tmp/eval-results.json

# Same thing as JSON (still writes the file).
node scripts/eval/run.mjs ... --json

# This example deliberately fails the thresholds (exit code 1).
node scripts/eval/run.mjs --hypothesis scripts/eval/example/hypothesis-bad.json \
  --clips scripts/eval/example/clips.json --thresholds scripts/eval/example/thresholds.json
```

Plain `node` works because `run.mjs` registers a tiny resolve hook (`ts-hooks.mjs`) so Node's
built-in TypeScript stripping can follow the repo's extensionless imports. There is nothing to
install and no bundler step.

## Files and defaults

| Option         | Default                          | Meaning                                       |
| -------------- | -------------------------------- | --------------------------------------------- |
| `--clips`      | `scripts/eval/clips.json`        | What to score                                  |
| `--hypothesis` | (required)                       | Output of the pipeline under test              |
| `--thresholds` | `scripts/eval/thresholds.json`   | Pass/fail limits (missing default file = MVP)  |
| `--out`        | `eval-results.json`              | Full machine-readable report                   |

The master brief calls the data directory `eval/`; this track owns `scripts/eval/`, so the paths are
`scripts/eval/*.json`. Pass `--clips eval/clips.json` if the lead later creates that directory.

## Clips manifest

```json
{
  "version": 1,
  "clips": [
    {
      "id": "hinglish-talking-head",
      "language": "hinglish",
      "media": "media/clip.mp4",
      "tags": ["talking-head"],
      "reference": "yaar mujhe yeh video bahut achhi lagi hai",
      "referenceWords": [
        { "text": "yaar", "startMs": 0, "endMs": 300 },
        { "text": "mujhe", "startMs": 320, "endMs": 620 }
      ],
      "speech": [{ "startMs": 0, "endMs": 2585 }]
    }
  ]
}
```

| Field            | Required | Notes                                                                 |
| ---------------- | -------- | --------------------------------------------------------------------- |
| `id`             | yes      | Unique; also the key in the hypothesis file                            |
| `language`       | yes      | `hinglish`, `hindi` or `english`                                      |
| `media`          | yes      | Informational only: this tool never opens it. Relative to the manifest |
| `reference`      | yes      | Reference transcript; its normalised tokens are the WER denominator    |
| `referenceWords` | no       | Hand-checked word times. Enables the timing metrics                    |
| `speech`         | no       | VAD intervals in global ms. Enables the coverage metric                |
| `tags`           | no       | Matched against `thresholds.byTag`                                     |

If `referenceWords` are present they must spell the same sentence as `reference` (compared after the
same normalisation). A fixture with word times for a different sentence is rejected rather than
scored against the wrong timings.

## Hypothesis file

Exactly the pipeline's words, keyed by clip id:

```json
{
  "hinglish-talking-head": {
    "words": [
      { "text": "Yaar,", "startMs": 0, "endMs": 320, "confidence": 0.91 },
      { "text": "mujhe", "startMs": 320, "endMs": 645, "confidence": 0.94 }
    ]
  }
}
```

Only `text`, `startMs` and `endMs` affect the metrics. `confidence`, `index` and `windowIndex` are
optional and get safe defaults, so either a full `Word[]` export or a hand-written fixture works.

## Thresholds

```json
{
  "default": { "werMax": 0.18, "timingMaeMsMax": 120, "coverageMin": 0.995 },
  "byLanguage": { "english": { "werMax": 0.1 } },
  "byTag": { "talking-head": { "werMax": 0.15, "timingMaeMsMax": 80 } },
  "byClip": { "hard-clip": { "werMax": 0.25 } }
}
```

Limits are inclusive. Precedence, weakest to strongest: `default` → `byLanguage` → each tag in
manifest order → `byClip`. Unknown keys and unknown languages are rejected, so a typo cannot quietly
disable a limit. Built-in defaults are the MVP numbers above.

The same file can also carry a `gold` section for the real gold-set scorer. This scorer ignores it,
and the gold scorer ignores the MVP keys, so one `scripts/eval/thresholds.json` serves both. See
`scripts/eval/gold/README.md` for those limits.

## What is measured

**WER** — word-level Levenshtein after Hinglish-aware normalisation: the project's `normalizeToken`
lexicon first ("nahin"→"nahi", "bohot"→"bahut"), then punctuation removed, then lowercase (unless
`strictCase` in the library API). Devanagari combining marks are kept, so "है" and "हैं" stay
different words. Report includes substitutions / deletions / insertions and the full alignment.
`wer = errors / referenceWords`; an empty reference scores 1 if the hypothesis says anything.

**Timing** — only words the WER aligner matched. Absolute error in ms for:
- `onset` (start), `offset` (end), and `boundary` = per-word mean of the two (start only when the
  reference has no `endMs`). Each has mean (MAE), median, p90 (linear interpolation) and max.
- signed bias is included in the JSON report (positive = hypothesis late).
The MVP limit applies to `boundary` MAE.

**Coverage** — `auditCoverage` from `overlap-merge.ts`: the share of VAD speech time covered by
hypothesis words, plus the gaps of at least 500 ms. `null` (and therefore not enforced) when the clip
has no `speech` intervals, because 1/1 would be a fake pass.

A clip missing from the hypothesis file **fails** and appears in `missingClips`. Hypothesis ids the
manifest does not know are listed in `unknownClips` so a typo is visible.

## Exit codes

- `0` every clip passed
- `1` at least one clip failed a threshold, or has no hypothesis
- `2` bad arguments, unreadable file, invalid JSON, or a manifest/hypothesis that fails validation

`eval-results.json` is written in every case that gets as far as scoring (including failures), so a
CI job can archive the evidence.

## Real gold set (`gold-score.mjs`)

This harness scores **one** reference per clip and is the quick smoke test. The real Hinglish gold
set needs several accepted transcripts per clip, silence/music clips that must stay wordless, and
hand-checked karaoke timings. That is a separate scorer with its own manifest format:

```bash
node scripts/eval/gold-score.mjs \
  --gold scripts/eval/gold/example-gold.json \
  --hypotheses scripts/eval/gold/example-hypotheses.json \
  --out /tmp/gold-results.json --md /tmp/gold-report.md
```

It reports OIWER (minimum WER over the references) plus plain WER against `references[0]`, per-tag
mean/median/p90 WER, a fixed hard flag for clips above 50%, hallucinated words on `expectNoWords`
clips, and boundary MAE / p90 / max plus karaoke switch error and never-matched counts. The full
format, metric definitions, report schema and the `gold` threshold section are documented in
`scripts/eval/gold/README.md`. The example there is fake transcript data; real manifests and media
are git-ignored.

## Script-aware scoring (`score2.mjs`, Phase 1)

`gold-score.mjs` compares strings literally. A correct Devanagari transcript of a Roman reference
therefore scores ~100% WER, and a Roman transcript of a Devanagari reference is penalised on every
English loanword. `score2.mjs` keeps that raw number (nothing is hidden) and adds a second number
where the Devanagari side is transliterated first. It also adds timing F1 at 50/100 ms, explicit
substitution/deletion/insertion counts, and hallucination words per minute.

```bash
node scripts/eval/score2.mjs \
  --gold scripts/eval/gold/local/gold.json \
  --hypotheses scripts/eval/gold/local/hyp-high.json \
  --out /tmp/score2.json --md /tmp/score2.md \
  --duration silence=10000
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--gold` | (required) | Gold manifest: the `gold.json` shape plus optional `durationMs` and `noVoiceSpans` |
| `--hypotheses` | (required) | `{ model, backend, device, clips }`, exactly as `gold-score.mjs` reads it |
| `--out` | `score2-results.json` | Machine-readable report (schema 2) |
| `--md` | `score2-report.md` | Deterministic markdown report |
| `--json` | off | Print JSON instead of markdown (files are still written) |
| `--duration <id>=<ms>` | none | Clip length for a silence words/minute rate; repeat per clip |
| `--no-voice-span <id>=<s>-<e>` | none | Music-only span in ms; repeat to add spans to one clip |
| `--help` | | Usage |

Exit codes: `0` every clip was scored, `1` at least one clip has no hypothesis, `2` bad arguments,
unreadable/invalid JSON or a manifest that fails validation.

### What is measured

**Raw WER** is the old comparison: NFC, `normalizeToken`, punctuation removed, combining marks kept,
and no transliteration. It is always reported next to the aware number.

**Script-aware OIWER** uses the same word Levenshtein alignment after transliterating Devanagari
tokens. The policy is: both sides mostly Devanagari -> compare raw; otherwise transliterate the
Devanagari tokens on both sides (Latin tokens are unchanged). The report records which side was
translated and the Devanagari share that triggered it. Both OIWERs are the minimum WER over every
accepted reference; the chosen reference also supplies the reference/hypothesis word counts and the
substitution/deletion/insertion split.

**Hallucination** is `words / minutes`. For an `expectNoWords` clip the denominator is `durationMs`
(`null`, never zero, when the duration is unknown). `noVoiceSpans` declare music-only stretches inside
any clip; a hypothesis word counts when its midpoint is in the span, and overlapping spans are
unioned before dividing. Per-span counts are also reported.

**Timing F1** uses a word-level Levenshtein alignment on the same normalised text as the WER. A
matched word is correct at tolerance `t` when `|hypStart-refStart| <= t` AND
`|hypEnd-refEnd| <= t`. Precision = correct / hypothesis words, recall = correct / reference words,
F1 = 2PR/(P+R); `t` is 50 and 100 ms. The report also gives boundary MAE (mean of the two absolute
errors), onset MAE, offset bias and matched/unusable counts. If any matched reference word has no
`endMs`, F1 is `null` rather than guessed; onset MAE is still reported.

### Transliteration rule set

The key is deterministic and lives in `src/lib/captioning/eval/score2.ts`. Consonants, independent
vowels and matras follow the **ITRANS 5.30** table (Avnish Chopra, <https://www.aczoom.com/itrans/>)
with these deliberate Roman-Hinglish simplifications:

- long/short vowels merge (`आ` and `अ` both `a`, `ई`/`इ` both `i`, `ऊ`/`उ` both `u`);
- `ऋ` -> `ri`, `ए` -> `e`, `ऐ` -> `ai`, `ओ` -> `o`, `औ` -> `au`;
- retroflex and dental consonants share the same Roman letter (`ट`/`त` -> `t`, `ड`/`द` -> `d`,
  `ण`/`न` -> `n`), because Hinglish does not distinguish them in writing;
- nukta consonants follow Hinglish, not IAST: `ज़` -> `z`, `क़` -> `q`, `फ़` -> `f`, and
  `ड़`/`ढ़` -> `d`/`dh` (`बड़ा` -> `bada`, `पढ़ना` -> `padhna`);
- `श`/`ष` -> `sh`, `व` -> `v`, `ं`/`ँ` -> `n` (or `m` before a labial: `संभव` -> `sambhav`);
- Hindi schwa deletion: an inherent `a` is dropped word-finally and before a consonant carrying an
  explicit matra (`इतने` -> `itne`, `कमरा` -> `kamra`), but kept word-initially (`बड़ा` -> `bada`)
  and before an inherent vowel (`कमल` -> `kamal`);
- Devanagari digits map to ASCII; danda, avagraha, zero-width joiners and Vedic accents are dropped
  from the key (the raw WER keeps them);
- a closed map handles high-frequency function words with conventional spellings (`में` -> `mein`,
  `आप` -> `aap`, `तो` -> `toh`, `वाले` -> `wale`, `नहीं` -> `nahi`) and English loanwords that
  Hindi writes phonetically (`स्कूल` -> `school`, `स्टूडेंट्स` -> `students`, `मार्क्स` -> `marks`,
  `डिफरेंट` -> `different`). The map is deliberately small; an unseen word uses the phonetic rules.

This is a lossy key, not a scholarly transcription: `स्कूल` would otherwise be `skul`, and
`ज़िंदगी`/`हमारा` are explicit exceptions to the schwa rule. The raw WER remains the honest floor.

Sanity check: a hand-written Devanagari rendering of the first studypoint sentence scores raw
OIWER **1.000** and script-aware **0.050** against the Roman reference (the only miss is
`जानते` -> `jante` versus the reference's `jaante`). A scorer that reported ~1.0 for the aware
number would be broken.

### Input extensions

`durationMs` (whole ms, > 0) and `noVoiceSpans` (`[{ startMs, endMs }]`, `endMs > startMs`) are read
by score2 only. They are optional, so a plain `gold.json` still works; the CLI overrides exist so a
local baseline does not have to edit the shared manifest. The reader validates both, rejects unknown
keys, and checks that `wordTimes` spell `references[0]` after script-aware normalisation.
