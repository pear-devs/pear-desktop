# Lyrics domain

`LyricResult` is the provider-independent result. `syncLevel` describes plain,
line, word, or syllable synchronization. Plain text stays in `lyrics` without
fabricated timestamps; a provider may also supply it as a synchronized result's
fallback. Timed `lines` and `segments` use milliseconds and exact source text.
Translation and romanization are optional source fields on lines.

`normalizeLines` preserves valid explicit ends, otherwise uses the next start,
then a valid known track duration, then leaves the end absent. Intro spacers are
ordinary blank lines spanning zero to the first positive start. Negative offset
times are preserved, not clamped. Durations, timecodes, and playback statuses
belong only to the renderer; they are not cached source data.

LRC supports whole seconds and one/two/three decimal places. Enhanced LRC slices
text between timestamps without splitting words or inserting spaces. A terminal
timestamp preserves the explicit segment/line end. Repeated line timestamps
repeat segment timing relative to the first timestamp. All source times shift
before end inference; track duration itself is not shifted. Enhanced LRC uses
the `word` convention because the format does not declare word versus syllable
granularity; the model supports explicitly declared syllables independently.

Consecutive enhanced markers retain empty timed segments for each gap. The first
following marker closes a segment once; a terminal marker ends the line without
inventing another segment. Empty intervals may have zero duration.

Normalization validates nested timing after offset/end inference: nonfinite,
out-of-line or decreasing segment starts lose their timing entry, without
reordering other segments or rewriting `line.text`. Invalid/out-of-line segment
ends become absent, not clamped; valid explicit ends remain unchanged. Thus a
malformed line may have only partially timed text. Invalid line starts cannot
form a timed line and are discarded; unrelated valid lines remain. Nonfinite
ends or overflowing intervals are never retained. Unrecognized malformed markers
stay literal text; recognized numeric markers with invalid timing lose their
timing, not their associated text.

Persistent cache schema v2 intentionally ignores v1 entries rather than keeping
an old-model compatibility adapter. Search, provider ranking and cache policy
are unchanged.

Follow-up: LyricsFile parsing can directly produce `LyricLine`/`LyricSegment`,
preserving source `start_ms`/`end_ms`. No LyricsFile parser or new provider is
introduced in this stage. Segment-level highlighting and translation display
remain separate renderer work; no live provider/UI validation is implied by
parser and mocked provider tests.
