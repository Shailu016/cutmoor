/**
 * Roman-Hinglish spelling families for document-level consensus (spelling v2).
 *
 * This is deliberately a typed TypeScript table, not JSON: the table is part of the
 * matching logic and reviewers must be able to read the admission comment next to
 * the data. `spelling.ts` derives the lookup indexes from it at module load.
 *
 * ADMISSION POLICY (the same rule normalize.ts uses, applied harder):
 * A family is admitted only when EVERY spelling in it is a Roman-Hinglish spelling
 * of ONE word and is not also a different common English or Hindi word, a common
 * abbreviation, or a recognisable name/brand. A wrong correction is a bug; a missed
 * correction is only cosmetic. When in doubt the word stays out.
 *
 * REJECTED ON PURPOSE (do not add these back):
 *  - kam        "less" in Hindi; also a name. (kaam = work stays, but its phonetic
 *               key "kam" is blocked so the two can never merge.)
 *  - nai        "new"/"barber" in Hindi, not a misspelling of nahi.
 *  - kia        Kia the car brand, and "kiya" (did) is a different word.
 *  - han        Han (surname / dynasty) and an English interjection-ish token.
 *  - kon        Kon (name/place), not a misspelling of kaun.
 *  - pagar      "salary" in Hindi, not "pagal" (mad).
 *  - fir        English fir tree; phir (then) is the Hinglish word.
 *  - bat        English bat / cricket bat; baat (thing/talk) is different.
 *  - rat        English rat; raat (night) is different.
 *  - bad        English bad; baad (after) is different.
 *  - sham       English sham (fake); shaam (evening) is different.
 *  - sal        English sal tree; saal (year) is different.
 *  - pas        English/French pas (a step); paas (near) is different.
 *  - niche      English niche; neeche (below) is different.
 *  - age        English age; aage (ahead) is different.
 *  - to         English preposition; toh (then/emphasis) is different.
 *  - na         English "na" / chemical symbol; the Hindi particle is too short.
 *  - koi        English koi (the carp); Hindi koi (some) is a different word.
 *  - log        English log; Hindi log (people) is a different word.
 *  - din        English din (noise); Hindi din (day) is a different word.
 *  - tab        English tab (browser); Hindi tab (then) is a different word.
 *  - jab        English jab (injection); Hindi jab (when) is a different word.
 *  - agar       English agar (lab medium); Hindi agar (if) is a different word.
 *  - zara       Zara the brand / a given name; too risky in lowercase.
 *  - main       English main; the Hindi pronoun is usually written "mein".
 *  - hum        English verb to hum; the Hindi pronoun is a different word.
 *  - ya         English "ya" (you); Hindi ya (or) is too short to be safe.
 *  - ab         English "ab" (abdominal muscle); Hindi ab (now) is too short.
 *  - bhut       Hindi bhoot (ghost), not bahut (very).
 *  - suna       Hindi "heard" (different tense from sunna, to listen).
 *  - bhar       Hindi bhar (fill/weight), not bahar (outside).
 *  - ha         English interjection "ha"; haa is a spelling of haan.
 *  - sb, ig, tm, id, yr  common English abbreviations; too ambiguous.
 *  - jada       name "Jada"; jyada/zada are the safe spellings of zyada.
 *  - samaj      Hindi "society" (समाज), not samajh (understand). Still listed as a samajh
 *               variant because the v1 LEXICON in normalize.ts maps samaj -> samajh anyway and
 *               removing it here would change nothing; that file is outside this work package.
 *               See .team/auto/wp-h.md (documented limitation).
 *  - janta      Hindi "the public" (जनता), not jaanta (knows). Key blocked too.
 *  - ana        English "ana" / the coin "anna"; aana (to come) is a different word.
 *               Key "ana" is blocked so neither "ana" nor "anna" can join aana.
 *  - sat        English "sat" and Hindi saat (seven); key blocked so neither can
 *               become saath (with).
 *  - sun        English "sun"; key blocked so neither "sun" nor "sunn" joins sunna.
 *  - bass       English bass (fish/instrument); bas (enough) is a different word.
 *  - dill       English dill (the herb); dil (heart) is a different word.
 *  - saab       Hindi sahab/saab (sir), not sab (all).
 *  - patta      Hindi patta (leaf), not pata (known / address).
 *  - kaal       Hindi kaal (time/death) is ambiguous with kal (yesterday/tomorrow).
 *
 * CHECKED AND KEPT (real-word homographs that are still the same word in captioning):
 *  - vala, vale, vali -> wala, wale, wali. v/w is the most common Roman-Hinglish
 *    variation; the English homographs are literary/obscure (vale = valley,
 *    vali = governor) and are capitalised when they are names. Dropping them would
 *    lose real Hinglish spellings, not just a cosmetic variant.
 *  - ye -> yeh. English "ye" is archaic; in captions "ye" is the Hindi this/these.
 *  - sunn -> sunna. Rare English (sunn hemp); kept as the doubled-letter spelling.
 *  - nam -> naam, pani -> paani, humen -> humein. No English word; same Hindi word.
 *  - Identity-only families whose only spelling is also an English word or given name
 *    (hue, tum, kar, kare, sahi, abhi, magar, jata, bas, dono): canonical equals every
 *    variant, so the pass rewrites nothing and cannot damage the token. Where a COMMON
 *    word is one edit away their fuzzy key is blocked instead (bas, dil, kal, pata, sab).
 *
 * Everything here only rewrites LOWERCASE tokens. Capitalised and ALL-CAPS tokens
 * (names, sentence starts, acronyms) are never touched, so "Kyun", "Kon", "Han",
 * "Rahul", "NASA" and "Delhi" stay exactly as the recogniser produced them.
 */

export interface SpellingFamily {
  /** The preferred spelling for this word. Always lowercase. */
  readonly canonical: string;
  /** Other spellings seen from the recogniser. Lowercase. */
  readonly variants: readonly string[];
  /** Short gloss so a reviewer can check the family without speaking Hinglish. */
  readonly meaning: string;
}

export const SPELLING_FAMILIES: readonly SpellingFamily[] = [
  // ---- negation, question words, particles ----------------------------------------------------
  { canonical: "nahi", variants: ["nahi", "nahin", "nhi", "nahii", "nahee", "nahe"], meaning: "no / not" },
  { canonical: "hai", variants: ["hai", "hae"], meaning: "is" },
  { canonical: "hain", variants: ["hain", "haien", "hainn"], meaning: "are (plural)" },
  { canonical: "tha", variants: ["tha"], meaning: "was (masc.)" },
  { canonical: "thi", variants: ["thi"], meaning: "was (fem.)" },
  { canonical: "haan", variants: ["haan", "haa"], meaning: "yes" },
  { canonical: "kya", variants: ["kya", "kyaa"], meaning: "what" },
  { canonical: "kyun", variants: ["kyun", "kyu", "kyon"], meaning: "why" },
  { canonical: "kyunki", variants: ["kyunki", "kyuki"], meaning: "because" },
  { canonical: "kaise", variants: ["kaise", "kese"], meaning: "how" },
  { canonical: "kaisa", variants: ["kaisa", "kesa"], meaning: "how (masculine)" },
  { canonical: "kaun", variants: ["kaun"], meaning: "who" },
  { canonical: "bhi", variants: ["bhi", "bhii"], meaning: "also" },
  { canonical: "bahut", variants: ["bahut", "bohot", "bahot", "bhot"], meaning: "very / a lot" },
  { canonical: "achha", variants: ["achha", "acha", "accha", "achcha"], meaning: "good / okay" },
  { canonical: "theek", variants: ["theek", "thik"], meaning: "fine / correct" },
  { canonical: "matlab", variants: ["matlab", "mtlb"], meaning: "meaning" },
  { canonical: "yaar", variants: ["yaar", "yar"], meaning: "friend / hey" },
  { canonical: "bhai", variants: ["bhai"], meaning: "brother / bro" },
  { canonical: "thoda", variants: ["thoda", "thda", "thora"], meaning: "a little" },
  { canonical: "zyada", variants: ["zyada", "zada", "jyada"], meaning: "more" },
  { canonical: "sirf", variants: ["sirf", "sirph"], meaning: "only" },
  // Added from real captions: the speech model writes long vowels ("jaata", "kijie", "chaahe"); casual Hinglish writes them short.
  { canonical: "kijiye", variants: ["kijiye", "kijie", "kijiyae"], meaning: "please do (polite request)" },
  { canonical: "hamara", variants: ["hamara", "hamaara"], meaning: "our" },
  { canonical: "jata", variants: ["jata", "jaata"], meaning: "goes / is done" },
  { canonical: "chahe", variants: ["chahe", "chaahe"], meaning: "whether / even if" },
  { canonical: "taiyari", variants: ["taiyari", "taiyaari", "tayari", "tayaari"], meaning: "preparation" },
  { canonical: "dikhta", variants: ["dikhta"], meaning: "is visible" },
  { canonical: "karaya", variants: ["karaya", "karaaya"], meaning: "got done / made to do" },
  { canonical: "padhne", variants: ["padhne"], meaning: "to study" },
  { canonical: "lekin", variants: ["lekin", "lakin"], meaning: "but" },
  { canonical: "magar", variants: ["magar"], meaning: "but" },
  { canonical: "phir", variants: ["phir"], meaning: "then / again" },
  { canonical: "abhi", variants: ["abhi", "abhee"], meaning: "right now" },
  { canonical: "bas", variants: ["bas"], meaning: "enough / just" },
  { canonical: "toh", variants: ["toh"], meaning: "then (emphasis)" },
  { canonical: "warna", variants: ["warna"], meaning: "otherwise" },
  { canonical: "bilkul", variants: ["bilkul", "bilkool"], meaning: "completely" },
  { canonical: "isliye", variants: ["isliye", "isliyee"], meaning: "therefore" },
  { canonical: "aur", variants: ["aur"], meaning: "and / more" },
  { canonical: "kal", variants: ["kal"], meaning: "yesterday / tomorrow" },
  { canonical: "aaj", variants: ["aaj", "aj"], meaning: "today" },
  { canonical: "roz", variants: ["roz", "roj"], meaning: "every day" },
  { canonical: "subah", variants: ["subah", "subha"], meaning: "morning" },
  { canonical: "mahina", variants: ["mahina", "maheena"], meaning: "month" },
  { canonical: "pehle", variants: ["pehle", "phele"], meaning: "before / first" },
  { canonical: "pehla", variants: ["pehla", "phla"], meaning: "first" },
  { canonical: "dusra", variants: ["dusra", "doosra"], meaning: "second / other" },
  { canonical: "teesra", variants: ["teesra", "tisra"], meaning: "third" },
  { canonical: "sabse", variants: ["sabse", "sbse"], meaning: "most / of all" },
  { canonical: "jaise", variants: ["jaise", "jese"], meaning: "like / as" },
  { canonical: "waise", variants: ["waise", "wese"], meaning: "likewise" },
  { canonical: "aisa", variants: ["aisa", "esa"], meaning: "like this" },
  { canonical: "waisa", variants: ["waisa", "wesa"], meaning: "like that" },
  { canonical: "itna", variants: ["itna", "itnaa"], meaning: "this much" },
  { canonical: "utna", variants: ["utna"], meaning: "that much" },
  { canonical: "kitna", variants: ["kitna", "kitnaa"], meaning: "how much" },
  { canonical: "yahi", variants: ["yahi", "yhi"], meaning: "this very" },
  { canonical: "wahi", variants: ["wahi", "vahi", "wohi"], meaning: "that very" },

  // ---- pronouns and possessives ---------------------------------------------------------------
  { canonical: "mera", variants: ["mera", "mra"], meaning: "my (masc.)" },
  { canonical: "meri", variants: ["meri", "mri"], meaning: "my (fem.)" },
  { canonical: "mujhe", variants: ["mujhe", "muje", "mujhey"], meaning: "to me" },
  { canonical: "tujhe", variants: ["tujhe", "tuje"], meaning: "to you (intimate)" },
  { canonical: "humein", variants: ["humein", "hume", "humen"], meaning: "to us" },
  { canonical: "tumhe", variants: ["tumhe", "tumhein", "tumhey"], meaning: "to you" },
  { canonical: "tum", variants: ["tum"], meaning: "you (informal)" },
  { canonical: "yeh", variants: ["yeh", "ye"], meaning: "this / these" },
  { canonical: "woh", variants: ["woh", "wo", "voh", "vo"], meaning: "that / they" },
  { canonical: "yahan", variants: ["yahan", "yaha"], meaning: "here" },
  { canonical: "wahan", variants: ["wahan", "waha"], meaning: "there" },
  { canonical: "apna", variants: ["apna", "apnaa"], meaning: "own (masc.)" },
  { canonical: "apni", variants: ["apni"], meaning: "own (fem.)" },
  { canonical: "apne", variants: ["apne"], meaning: "own (plural)" },
  { canonical: "unka", variants: ["unka", "unkaa"], meaning: "their (masc.)" },
  { canonical: "unki", variants: ["unki"], meaning: "their (fem.)" },
  { canonical: "uska", variants: ["uska"], meaning: "his/her (masc.)" },
  { canonical: "uski", variants: ["uski"], meaning: "his/her (fem.)" },
  { canonical: "iska", variants: ["iska"], meaning: "its/his (masc.)" },
  { canonical: "iski", variants: ["iski"], meaning: "its/his (fem.)" },
  { canonical: "inka", variants: ["inka"], meaning: "their (masc.)" },
  { canonical: "kisi", variants: ["kisi"], meaning: "someone / any" },
  { canonical: "sab", variants: ["sab"], meaning: "all" },
  { canonical: "sabhi", variants: ["sabhi", "sbhi"], meaning: "everyone" },
  { canonical: "dono", variants: ["dono"], meaning: "both" },
  { canonical: "kuch", variants: ["kuch", "kch"], meaning: "something" },

  // ---- verbs: kar / ho / ja / aa / dekh / bol / sun / samajh ----------------------------------
  { canonical: "karo", variants: ["karo", "kro"], meaning: "do (imperative)" },
  { canonical: "karna", variants: ["karna", "krna"], meaning: "to do" },
  { canonical: "karta", variants: ["karta", "krta"], meaning: "does (masc.)" },
  { canonical: "karti", variants: ["karti", "krti"], meaning: "does (fem.)" },
  { canonical: "karte", variants: ["karte", "krte"], meaning: "do (plural)" },
  { canonical: "kar", variants: ["kar", "kr"], meaning: "do (stem)" },
  { canonical: "kare", variants: ["kare", "kre"], meaning: "does (subjunctive)" },
  { canonical: "kiya", variants: ["kiya"], meaning: "did" },
  { canonical: "raha", variants: ["raha", "rha"], meaning: "staying (masc.)" },
  { canonical: "rahi", variants: ["rahi", "rhi"], meaning: "staying (fem.)" },
  { canonical: "rahe", variants: ["rahe", "rhe"], meaning: "staying (plural)" },
  { canonical: "gaya", variants: ["gaya", "gya"], meaning: "went (masc.)" },
  { canonical: "gayi", variants: ["gayi", "gyi"], meaning: "went (fem.)" },
  { canonical: "gaye", variants: ["gaye", "gye"], meaning: "went (plural)" },
  { canonical: "hona", variants: ["hona"], meaning: "to be" },
  { canonical: "hota", variants: ["hota", "hotaa"], meaning: "happens (masc.)" },
  { canonical: "hoti", variants: ["hoti"], meaning: "happens (fem.)" },
  { canonical: "hote", variants: ["hote"], meaning: "happen (plural)" },
  { canonical: "hua", variants: ["hua", "huaa"], meaning: "happened (masc.)" },
  { canonical: "hui", variants: ["hui"], meaning: "happened (fem.)" },
  { canonical: "hue", variants: ["hue"], meaning: "happened (plural)" },
  { canonical: "jaana", variants: ["jaana", "jana"], meaning: "to go" },
  { canonical: "aana", variants: ["aana"], meaning: "to come" },
  { canonical: "chalo", variants: ["chalo"], meaning: "let's go" },
  { canonical: "dekho", variants: ["dekho"], meaning: "look (imperative)" },
  { canonical: "dekhna", variants: ["dekhna", "dekna"], meaning: "to see" },
  { canonical: "bolna", variants: ["bolna", "bolnaa"], meaning: "to speak" },
  { canonical: "suno", variants: ["suno"], meaning: "listen (imperative)" },
  // Data-built (WP-H): "sunie" occurs in the model output and is not a word in any language;
  // "suniye" is the established -iye polite imperative (cf. kijiye). The aligned reference
  // uses "suniye". This is the only aligned pair that survived the two-different-words check.
  { canonical: "suniye", variants: ["suniye", "sunie"], meaning: "listen (polite imperative)" },
  { canonical: "sunna", variants: ["sunna", "sunn"], meaning: "to listen" },
  { canonical: "samajh", variants: ["samajh", "samj", "samaj"], meaning: "understand" },
  { canonical: "batao", variants: ["batao", "btao"], meaning: "tell (imperative)" },
  { canonical: "chahiye", variants: ["chahiye", "chaiye", "chahiyee"], meaning: "want / needed" },
  { canonical: "lagta", variants: ["lagta", "lgta"], meaning: "seems (masc.)" },
  { canonical: "milta", variants: ["milta", "mlta"], meaning: "is found" },
  { canonical: "jaanta", variants: ["jaanta"], meaning: "knows" },
  { canonical: "pata", variants: ["pata"], meaning: "known / address" },

  // ---- everyday nouns and adjectives ----------------------------------------------------------
  { canonical: "pyaar", variants: ["pyaar", "pyar"], meaning: "love" },
  { canonical: "zindagi", variants: ["zindagi", "zindgi", "jindagi"], meaning: "life" },
  { canonical: "kaam", variants: ["kaam"], meaning: "work" },
  { canonical: "samay", variants: ["samay"], meaning: "time" },
  { canonical: "waqt", variants: ["waqt", "wakt", "vakt", "vaqt"], meaning: "time" },
  { canonical: "sahi", variants: ["sahi"], meaning: "correct" },
  { canonical: "galat", variants: ["galat", "galt"], meaning: "wrong" },
  { canonical: "wala", variants: ["wala", "vala"], meaning: "one associated with" },
  { canonical: "wali", variants: ["wali", "vali"], meaning: "one associated with (fem.)" },
  { canonical: "wale", variants: ["wale", "vale"], meaning: "ones associated with" },
  { canonical: "pagal", variants: ["pagal", "paagal", "paagar"], meaning: "mad" },
  { canonical: "dil", variants: ["dil"], meaning: "heart" },
  { canonical: "ghar", variants: ["ghar"], meaning: "home" },
  { canonical: "naam", variants: ["naam", "nam"], meaning: "name" },
  { canonical: "dost", variants: ["dost"], meaning: "friend" },
  { canonical: "paisa", variants: ["paisa", "paisaa"], meaning: "money" },
  { canonical: "paani", variants: ["paani", "pani"], meaning: "water" },
  { canonical: "khaana", variants: ["khaana", "khana"], meaning: "food / to eat" },
  { canonical: "idhar", variants: ["idhar", "idhr"], meaning: "here / this way" },
  { canonical: "udhar", variants: ["udhar", "udhr"], meaning: "there / that way" },
  { canonical: "upar", variants: ["upar", "upr", "oopar"], meaning: "up / above" },
  { canonical: "peeche", variants: ["peeche", "piche"], meaning: "behind" },
  { canonical: "saath", variants: ["saath", "sath"], meaning: "with / together" },
  { canonical: "saamne", variants: ["saamne", "samne"], meaning: "in front" },
  { canonical: "andar", variants: ["andar", "andr"], meaning: "inside" },
  { canonical: "bahar", variants: ["bahar", "bahaar"], meaning: "outside" },
];

/**
 * Phonetic keys that are real words in English or Hindi with a different meaning.
 * `spelling.ts` refuses to use them for fuzzy matching, so "kam" can never become
 * "kaam", "fir" can never become "phir" and "bat" can never become "baat".
 * Exact listed spellings still work normally; only unseen near-misses are ignored.
 *
 * The last block was added in the WP-H audit. Each entry is a word the fuzzy path used
 * to rewrite into a different word: sat/saat -> saath, sun -> sunna, bass -> bas,
 * dill -> dil, saab -> sab, patta -> pata, kaal -> kal, ana/anna -> aana, and the
 * removed variant janta -> jaanta.
 */
export const BLOCKED_PHONETIC_KEYS: readonly string[] = [
  "kam",
  "nai",
  "kia",
  "han",
  "ha",
  "kon",
  "pagar",
  "dikhata",
  "padhane",
  "fir",
  "bat",
  "rat",
  "bad",
  "sham",
  "sal",
  "pas",
  "niche",
  "age",
  "to",
  "na",
  "koi",
  "log",
  "din",
  "tab",
  "jab",
  "agar",
  "zara",
  "main",
  "hum",
  "ya",
  "ab",
  "bhut",
  "suna",
  "bhar",
  "sb",
  "ig",
  "tm",
  "id",
  "yr",
  "jada",
  "janta",
  "sat",
  "sun",
  "bas",
  "dil",
  "sab",
  "pata",
  "kal",
  "ana",
];

/**
 * Words the admission policy rejects, exported so a test can prove none of them is
 * ever rewritten. Keep this list in sync with the comment block at the top.
 */
export const REJECTED_SPELLINGS: readonly { readonly word: string; readonly reason: string }[] = [
  { word: "kam", reason: "less; kaam (work) is a different word" },
  { word: "nai", reason: "new / barber, not nahi" },
  { word: "kia", reason: "Kia brand / kiya (did)" },
  { word: "han", reason: "Han name; not the same word as haan" },
  { word: "ha", reason: "English interjection; too short to be haan" },
  { word: "kon", reason: "name/place; not kaun" },
  { word: "pagar", reason: "salary; not pagal" },
  { word: "dikhata", reason: "shows (from dikhana); dikhta is a different verb (dikhna, is visible)" },
  { word: "padhane", reason: "to teach (from padhana); padhne is a different verb (padhna, to study)" },
  { word: "fir", reason: "fir tree; phir is different" },
  { word: "bat", reason: "bat (object/animal); baat is different" },
  { word: "rat", reason: "rat (animal); raat is different" },
  { word: "bad", reason: "English bad; baad is different" },
  { word: "sham", reason: "English sham; shaam is different" },
  { word: "sal", reason: "sal tree; saal is different" },
  { word: "pas", reason: "pas (step); paas is different" },
  { word: "niche", reason: "English niche; neeche is different" },
  { word: "age", reason: "English age; aage is different" },
  { word: "to", reason: "English preposition; toh is different" },
  { word: "na", reason: "too short and ambiguous" },
  { word: "koi", reason: "koi carp; Hindi koi is a different word" },
  { word: "log", reason: "English log; Hindi log is a different word" },
  { word: "din", reason: "English din; Hindi din is a different word" },
  { word: "tab", reason: "browser tab; Hindi tab is a different word" },
  { word: "jab", reason: "injection jab; Hindi jab is a different word" },
  { word: "agar", reason: "lab agar; Hindi agar is a different word" },
  { word: "zara", reason: "brand / given name" },
  { word: "main", reason: "English main; pronoun is mein" },
  { word: "hum", reason: "English verb hum; Hindi pronoun is different" },
  { word: "ya", reason: "too short and ambiguous" },
  { word: "ab", reason: "abdominal abbreviation; too short" },
  { word: "bhut", reason: "bhoot (ghost), not bahut" },
  { word: "suna", reason: "heard, not sunna (to listen)" },
  { word: "bhar", reason: "fill/weight, not bahar" },
  { word: "sb", reason: "common abbreviation" },
  { word: "ig", reason: "I guess / Instagram abbreviation" },
  { word: "tm", reason: "trademark abbreviation" },
  { word: "id", reason: "identifier; English abbreviation" },
  { word: "yr", reason: "year abbreviation" },
  { word: "jada", reason: "given name; use jyada/zada" },
  { word: "janta", reason: "Hindi the public (जनता); jaanta (knows) is a different word" },
  { word: "ana", reason: "English ana / the coin anna; aana (to come) is a different word" },
  { word: "anna", reason: "the coin anna; not aana (to come)" },
  { word: "sat", reason: "English sat and Hindi saat (seven); not saath (with)" },
  { word: "saat", reason: "Hindi seven; not saath (with)" },
  { word: "sun", reason: "English sun; not sunna (to listen)" },
  { word: "bass", reason: "English bass; not bas (enough)" },
  { word: "dill", reason: "English dill (herb); not dil (heart)" },
  { word: "saab", reason: "Hindi sahab/saab (sir); not sab (all)" },
  { word: "patta", reason: "Hindi patta (leaf); not pata (known/address)" },
  { word: "kaal", reason: "Hindi kaal (time/death); ambiguous with kal (yesterday/tomorrow)" },
];
