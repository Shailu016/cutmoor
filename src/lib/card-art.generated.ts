// Written by scripts/make-card-art.mjs and scripts/make-captions-card.mjs from real runs of the tool pages. Do not edit by hand.
export interface CardArtFile { w: number; h: number; duration: number | null }
export interface CardArtEntry {
  /** split / strip: real before and after output. frames: a row of real frames of the tool's own live preview (Auto captions). */
  mode: "split" | "strip" | "frames";
  /** Sizes of the input and the output file. Not used by "frames" cards (zero). */
  beforeBytes: number;
  afterBytes: number;
  name: string;
  before: CardArtFile;
  after: CardArtFile;
  /** Trim only: the part of the source that was kept, in seconds (the settings the run used). */
  keep?: [number, number];
  /** frames only: how many frames the picture holds, and the sample text the tool's stand-in engine wrote. */
  frames?: number;
  sampleText?: string;
}

export const CARD_ART: Record<string, CardArtEntry> = {
  "trim": {
    "mode": "strip",
    "beforeBytes": 2432376,
    "afterBytes": 149250,
    "name": "slate-shot-trimmed.mp4",
    "before": {
      "w": 1280,
      "h": 720,
      "duration": 6
    },
    "after": {
      "w": 1280,
      "h": 720,
      "duration": 4
    },
    "keep": [
      2,
      6
    ]
  },
  "compress": {
    "mode": "split",
    "beforeBytes": 5732293,
    "afterBytes": 1952721,
    "name": "neon-city-compressed.mp4",
    "before": {
      "w": 1280,
      "h": 720,
      "duration": 6
    },
    "after": {
      "w": 1280,
      "h": 720,
      "duration": 6.016
    }
  },
  "resize": {
    "mode": "split",
    "beforeBytes": 872822,
    "afterBytes": 286571,
    "name": "desert-road-1080x1920.mp4",
    "before": {
      "w": 1280,
      "h": 720,
      "duration": 6
    },
    "after": {
      "w": 1080,
      "h": 1920,
      "duration": 6.016
    }
  },
  "video-speed": {
    "mode": "strip",
    "beforeBytes": 6442775,
    "afterBytes": 447164,
    "name": "timelapse-2x.mp4",
    "before": {
      "w": 1280,
      "h": 720,
      "duration": 6
    },
    "after": {
      "w": 1280,
      "h": 720,
      "duration": 3.083333
    }
  },
  "rotate-video": {
    "mode": "split",
    "beforeBytes": 4061093,
    "afterBytes": 246594,
    "name": "sideways-phone-rotated.mp4",
    "before": {
      "w": 1280,
      "h": 720,
      "duration": 6
    },
    "after": {
      "w": 720,
      "h": 1280,
      "duration": 6.016
    }
  },
  "compress-image": {
    "mode": "split",
    "beforeBytes": 699131,
    "afterBytes": 33980,
    "name": "studio-compressed.webp",
    "before": {
      "w": 1920,
      "h": 1080,
      "duration": null
    },
    "after": {
      "w": 1920,
      "h": 1080,
      "duration": null
    }
  },
  "resize-image": {
    "mode": "split",
    "beforeBytes": 273827,
    "afterBytes": 60623,
    "name": "mountains-1080x1080.jpg",
    "before": {
      "w": 1920,
      "h": 1080,
      "duration": null
    },
    "after": {
      "w": 1080,
      "h": 1080,
      "duration": null
    }
  },
  "crop-image": {
    "mode": "split",
    "beforeBytes": 348871,
    "afterBytes": 32461,
    "name": "product-cropped.jpg",
    "before": {
      "w": 1920,
      "h": 1080,
      "duration": null
    },
    "after": {
      "w": 1080,
      "h": 1080,
      "duration": null
    }
  },
  "convert-image": {
    "mode": "split",
    "beforeBytes": 4340091,
    "afterBytes": 597662,
    "name": "poster-converted.webp",
    "before": {
      "w": 1920,
      "h": 1080,
      "duration": null
    },
    "after": {
      "w": 1920,
      "h": 1080,
      "duration": null
    }
  },
  "watermark-image": {
    "mode": "split",
    "beforeBytes": 274394,
    "afterBytes": 110490,
    "name": "lake-watermarked.jpg",
    "before": {
      "w": 1920,
      "h": 1080,
      "duration": null
    },
    "after": {
      "w": 1920,
      "h": 1080,
      "duration": null
    }
  },
  "blur-image": {
    "mode": "split",
    "beforeBytes": 224410,
    "afterBytes": 61667,
    "name": "car-hidden.jpg",
    "before": {
      "w": 1920,
      "h": 1080,
      "duration": null
    },
    "after": {
      "w": 1920,
      "h": 1080,
      "duration": null
    }
  },
  "auto-captions": {
    "mode": "frames",
    "beforeBytes": 0,
    "afterBytes": 0,
    "name": "presenter.mp4",
    "before": {
      "w": 1280,
      "h": 720,
      "duration": 10
    },
    "after": {
      "w": 1280,
      "h": 720,
      "duration": 10
    },
    "frames": 11,
    "sampleText": "Hello everyone, today we will add captions to a video."
  }
};
