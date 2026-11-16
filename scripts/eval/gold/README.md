# Real gold set (private clips)

Scoring for the **real** Hinglish / Hindi / English gold set. This is the number that decides
whether a model or a timing change is actually better. It is separate from the tiny MVP example in
`scripts/eval/example/`:

| Tool | Input | Purpose |
| --- | --- | --- |
| `scripts/eval/run.mjs` | one transcript per clip | fast smoke test with the original MVP limits |
| `scripts/eval/gold-score.mjs` | several accepted transcripts, optional word times, silence clips | real gold set, multi-reference WER, hallucination and karaoke timing |

Everything is local and pure: no model runs, no media is opened, nothing is uploaded and no network
request is made. The scorer only measures words that already exist in a JSON file.

## 1. Add clips (once, then extend as you record more)

1. Put the media somewhere **outside git**, for example `scripts/eval/gold/local/media/`. The
   `.gitignore` in this folder ignores everything except this README and the fake example, so a
   real manifest and real media stay on your machine.
2. Create a manifest, for example `scripts/eval/gold/local/gold.json`, with 20-30 clips. Start with
   the clips you care about: phone videos, noisy rooms, children, fast speech, code-switching,
   English-heavy and Hindi-heavy speech, music, silence and long pauses. Tags come from this closed
   list:

   ```
   clean  noisy  child  fast  code-switch  english-heavy  hindi-heavy
   phone  music  silence  long-pause
   ```

3. For each clip: give a stable `id`, the local media `path` (never opened; kept out of git), one or
   more acceptable `references` (spelling variants are fine), and optionally hand-checked
   `wordTimes` and `expectNoWords`.

Minimum manifest:

```json
{
  "version": 1,
  "notes": "optional free text shown at the top of the report",
  "clips": [
    {
      "id": "phone-noisy-01",
      "path": "local/media/phone-noisy-01.m4a",
      "tags": ["noisy", "phone"],
      "references": ["delivery kal shaam tak aa jayegi"]
    }
  ]
}
```

All fields:

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Unique; also the key in the hypotheses file |
| `path` | yes | Local media path. Informational only: the scorer never opens it |
| `tags` | yes | Zero or more tags from the closed list above (duplicates collapse) |
| `references` | normal clips: yes | One or more acceptable transcripts. `references[0]` is the primary |
| `references` | `expectNoWords`: must be `[]` or omitted | A clip that must stay silent has nothing to transcribe |
| `wordTimes` | no | Hand-checked integer-ms times for `references[0]`; enables timing metrics |
| `expectNoWords` | no | `true` for silence/music clips. Requires a `silence` or `music` tag |

`wordTimes` must spell `references[0]` after the same normalisation the scorer uses, otherwise the
manifest is rejected (a fixture timed for a different sentence would silently score the wrong
timings). Spelling variants that normalise to the same words are accepted.

```json
{
  "id": "clean-01",
  "path": "local/media/clean-01.mp4",
  "tags": ["clean", "code-switch"],
  "references": ["yaar yeh video bahut achhi hai", "yaar ye video bahut achi hai"],
  "wordTimes": [
    { "text": "yaar", "startMs": 0, "endMs": 300 },
    { "text": "yeh", "startMs": 320, "endMs": 600 }
  ]
}
```

Rules enforced by the parser (so a typo fails loudly instead of skewing a number):

- ids are unique; tags must be in the closed list; unknown fields are rejected;
- integer milliseconds only, non-negative, `endMs >= startMs`;
- a normal clip needs at least one reference with at least one scoreable word;
- `expectNoWords: true` needs a `silence` or `music` tag, must not carry references or word times.

## 2. Produce the hypotheses file

Run the pipeline (FAST, HIGH, any experiment) on each clip and export its words. The file is:

```json
{
  "model": "whisper-fast-int8",
  "backend": "webgpu",
  "device": "laptop-rtx-3050",
  "clips": {
    "clean-01": {
      "seconds": 12.5,
      "words": [
        { "text": "yaar", "startMs": 0, "endMs": 310, "confidence": 0.91 },
        { "text": "ye", "startMs": 330, "endMs": 610, "confidence": 0.94 }
      ]
    },
    "silence-01": { "seconds": 1.2, "words": [] }
  }
}
```

- `model`, `backend`, `device` are required and are copied into the report. A WER number without
  the model, execution provider and device is not evidence.
- `clips[id].words` is the pipeline's `Word[]`. Only `text`, `startMs`, `endMs` affect the metrics;
  `confidence`, `index`, `windowIndex` are optional and get safe defaults.
- `clips[id].seconds` is optional wall-clock time for that clip; it is reported but not thresholded.
- A clip missing from `clips` fails. An unknown id is listed in `unknownClips` and never scored.

## 3. Run it

```bash
node scripts/eval/gold-score.mjs \
  --gold scripts/eval/gold/local/gold.json \
  --hypotheses scripts/eval/gold/local/fast-webgpu.json \
  --out scripts/eval/gold/local/fast-results.json \
  --md scripts/eval/gold/local/fast-report.md
```

Try the fake example first (it uses invented transcripts and timings; it does not describe real
audio):

```bash
node scripts/eval/gold-score.mjs \
  --gold scripts/eval/gold/example-gold.json \
  --hypotheses scripts/eval/gold/example-hypotheses.json \
  --out /tmp/example-gold-results.json \
  --md /tmp/example-gold-report.md
```

Options: `--out` (default `gold-results.json`), `--md` (default `gold-report.md`), `--thresholds`
(default `scripts/eval/thresholds.json`), `--json` (print JSON instead of markdown), `--help`.

Exit codes:

- `0` every gold limit passed
- `1` at least one limit failed (the report is still written as evidence)
- `2` bad arguments, unreadable file, invalid JSON, or a manifest/hypotheses file that fails
  validation

## 4. What the numbers mean

**WER and OIWER.** Every reference is compared with the hypothesis after the project's normaliser
(`normalizeToken`, then punctuation removed and lowercased). `wordErrorRate` computes
`(S + D + I) / referenceWords` with an exact minimum edit script.

- **OIWER** is the **minimum** WER over all references for that clip. A human typo or a valid
  alternative spelling in one reference cannot inflate the score.
- **plain WER** is always the WER against `references[0]`, so a variant-heavy primary reference is
  visible and cannot hide errors.
- `bestReference` and `referenceWers` show which reference won and what each one scored.

An empty reference is not allowed for normal clips. An empty hypothesis scores 1 when the reference
has words (every word is a deletion).

**Hallucination.** For `expectNoWords` clips, `wordsProduced` counts hypothesis words whose text
still contains a letter or digit after normalisation (a lone `...` is not a word). The contract is
zero. `hallucinated` is true whenever any word was produced.

**Timing.** Only when `wordTimes` exist. Words the WER aligner matched are compared:

- `boundary.maeMs` / `medianMs` / `p90Ms` / `maxMs`: per-word mean of |start error| and |end error|,
  falling back to start-only when a reference word has no `endMs`;
- `karaokeSwitchErrorMs`: mean |hypothesis start - reference start|, the highlight switch error;
- `neverMatchedWords`: reference words with no matched hypothesis word (deletions);
- `extraWords`: hypothesis words with no reference word (insertions);
- `onsetBiasMs`: signed bias, positive = hypothesis late.

**Per-tag aggregation.** For each tag present in the manifest: `clips` (scored clips), `werClips`
(clips with a WER; silence/music clips have none), unweighted `meanWer`, `medianWer`, `p90Wer`, and
`hardFailures`. Averages are unweighted on purpose: a three-word clip should not count less than a
paragraph, because the gold set is sampled by clip type, not by word count. p90 uses linear
interpolation (the same definition as numpy and the existing timing scorer).

**Hard flag.** `hard: true` whenever a clip's OIWER is **greater than 0.5**, exactly the v3 release
gate ("no clip > 50%"). It is fixed and independent of the configurable `clipWerMax` limit; every
hard clip is also listed in the top-level `hardFailures` array.

## 5. Thresholds and the verdict

`scripts/eval/thresholds.json` has a `gold` section next to the original MVP keys, so one file
serves both scorers. The gold scorer reads only `gold`; `run.mjs` ignores it.

```json
{
  "default": { "werMax": 0.18, "timingMaeMsMax": 120, "coverageMin": 0.995 },
  "gold": {
    "meanWerMax": 0.25,
    "clipWerMax": 0.5,
    "timingMaeMsMax": 120,
    "hallucinatedWordsMax": 0,
    "byTag": { "noisy": { "meanWerMax": 0.4 } }
  }
}
```

| Key | Default | Rule |
| --- | --- | --- |
| `meanWerMax` | `0.25` | Unweighted mean OIWER over scored clips, inclusive |
| `clipWerMax` | `0.5` | Every single-clip OIWER, inclusive |
| `timingMaeMsMax` | `120` | Every timing-measured clip's boundary MAE, inclusive |
| `hallucinatedWordsMax` | `0` | Words allowed on one `expectNoWords` clip, inclusive |
| `byTag` | `{}` | Optional tighter mean-WER limit per tag from the closed list |

A missing `gold` section uses these defaults. An explicitly passed thresholds file that does not
exist is an error (exit 2). Unknown keys, unknown tags and negative limits are rejected.

The run fails (exit 1) if the mean, a tag mean, a clip, a timing limit or a hallucination limit is
violated, or a manifest clip has no hypothesis. A hard flag alone fails the run only if
`clipWerMax` is below it, which is the default.

## 6. Report schema (JSON, `schemaVersion: 1`)

The JSON report is the stable contract; the markdown file is the same information for a reviewer.
There are no timestamps, absolute paths or locale-formatted numbers, so two runs with the same
inputs are byte-identical.

```json
{
  "schemaVersion": 1,
  "model": "whisper-fast-int8",
  "backend": "webgpu",
  "device": "laptop-rtx-3050",
  "manifestNotes": "optional manifest notes or null",
  "pass": true,
  "thresholds": {
    "meanWerMax": 0.25,
    "clipWerMax": 0.5,
    "timingMaeMsMax": 120,
    "hallucinatedWordsMax": 0,
    "byTag": { "noisy": { "meanWerMax": 0.4 } }
  },
  "summary": {
    "clips": 3,
    "scored": 3,
    "missing": 0,
    "expectNoWords": 1,
    "werClips": 2,
    "meanWer": 0.08333333333333333,
    "medianWer": 0.08333333333333333,
    "p90Wer": 0.15000000000000002,
    "maxWer": 0.16666666666666666,
    "plainMeanWer": 0.16666666666666666,
    "hardFailures": 0,
    "hallucinatedClips": 0,
    "hallucinatedWords": 0,
    "totalSeconds": 22,
    "meanSeconds": 7.333333333333333
  },
  "clips": [
    {
      "id": "clean-01",
      "path": "local/media/clean-01.mp4",
      "tags": ["clean"],
      "expectNoWords": false,
      "scored": true,
      "wer": {
        "oiwer": 0,
        "plainWer": 0.16666666666666666,
        "bestReference": 1,
        "referenceWers": [0.16666666666666666, 0],
        "refWords": 6,
        "hypWords": 6,
        "errors": 0,
        "substitutions": 0,
        "deletions": 0,
        "insertions": 0
      },
      "hallucination": null,
      "timing": {
        "matched": 5,
        "unusable": 0,
        "boundary": { "maeMs": 9, "medianMs": 10, "p90Ms": 10, "maxMs": 10 },
        "karaokeSwitchErrorMs": 8,
        "neverMatchedWords": 0,
        "extraWords": 0,
        "onsetBiasMs": 8
      },
      "seconds": 12.5,
      "hard": false,
      "failures": [],
      "notes": [],
      "pass": true
    }
  ],
  "byTag": [
    {
      "tag": "clean",
      "clips": 1,
      "werClips": 1,
      "meanWer": 0,
      "medianWer": 0,
      "p90Wer": 0,
      "hardFailures": 0
    }
  ],
  "hardFailures": [],
  "missingClips": [],
  "unknownClips": [],
  "failures": []
}
```

Nullable fields are honest: a metric that could not be measured is `null`, never `0`, `NaN` or
`Infinity`. `timing` is `null` when the clip has no `wordTimes`; `wer` is `null` for
`expectNoWords` clips; `hallucination` is `null` for normal clips.

`failures[]` entries:

```json
{ "metric": "tagWer", "scope": "tag", "target": "noisy", "actual": 0.42, "limit": 0.4, "rule": "max" }
```

`metric` is one of `missing`, `meanWer`, `clipWer`, `tagWer`, `timingMae`, `hallucinatedWords`;
`scope` is `run`, `tag` or `clip`; `target` is the tag/clip id (or `null` for run-wide). The same
clip failure appears in `clips[i].failures` and in the flattened top-level `failures[]`. A
`missing` failure has `actual: null` and `limit: null`.

## 7. Practical notes

- Start with 20-30 clips across the tags; 3 clips cannot decide a model. Re-run the same manifest for
  every candidate so the numbers are comparable.
- One reference is enough to start. Add a second only where a reviewer would genuinely accept more
  than one spelling; OIWER then ignores the difference.
- Word times are the expensive part. Add them to 5-10 clips first: that is enough to catch a
  systematic 200 ms shift. `neverMatchedWords` catches alignment failures that MAE hides.
- Keep any accuracy claim and the verdict out of the marketing copy until the gold set has 30
  clips and no hard failures.
