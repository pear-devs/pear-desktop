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

## Search infrastructure (Task 2)

`search/coordinator.ts` owns one track session: versioned metadata/config/provider
fingerprint, generation, AbortController, provider states, progressive candidates
and completion Promise. Identical active searches share the session, not polling.
Provider completions publish immediately; all providers have a 15-second deadline.
Track changes abort previous work; retry aborts/replaces that provider run and cache
entry. Identity guards reject stale results and cache writes, including ABA revisits.
Matching/ranking and preferences are owned by the common Task 3 system below.

`search/http.ts` bounds requests and response bodies (10 seconds by default),
classifies failures, validates JSON optionally and retries only safe GET requests
for transient failures, at most twice, within the original deadline. Providers
receive a search-context signal; matching options belong to common policy. Renderer fetch serves
Genius and YT browse; LRCLib/MusixMatch retain privileged Electron networking for
forbidden headers. IPC passes request IDs, not signals; cancellation aborts main
process fetches. Main process stop aborts all outstanding requests.

YouTube's existing internal `networkManager.fetch('/next')` has no exposed abort
API. Its wait is bounded, stale results are ignored and no browse request starts
after cancellation, but its underlying native request cannot currently be aborted.
Replacing that authenticated internal API without verification is intentionally
not claimed as solved. External provider fetches are genuinely aborted.

`search/cache.ts` replaces both old lyrics caches with a memory-only 75-track LRU,
30-minute success TTL and 30-second failure/no-match TTL. Aborts are not cached.
Explicit nested copies preserve Errors and optional domain fields; no JSON cloning.
Lightweight validation checks nested finite timing, intervals, ordering and line
bounds on writes and reads. Old localStorage cache v1/v2 entries are not consumed;
cache does not survive process restarts. Per-video source choices and MusixMatch's
existing short-lived token storage remain separate from the search cache.

## Common candidates and policy (Task 3)

Providers return only `LyricCandidate[]` (0/1/N), retaining source IDs, original
titles/artists, album, source duration in milliseconds, language/variant and exact
video association when known. Canonical `LyricResult` timing/content is unchanged.
Provider state/cache holds these arrays; selected renderer data is derived, not a
second single-result source of truth. Search fingerprint v4 includes candidate
schema/matching version. LRCLib retains every search result, Genius retrieves every
returned hit, MusixMatch retains subtitle variants, YTMusic records the actual
videoId -> lyrics browse association. Disabled Megalobiz remains disabled but uses
the same boundary. Query fallbacks are retrieval mechanics, never acceptance rules.

`search/matching.ts` preserves originals and exports reusable comparison/track
normalization. NFKC/case/punctuation/whitespace noise is normalized; only narrowly
identified official-video/audio noise is removed. Live/remix/remaster/acoustic/
instrumental/karaoke/sped-up/slowed/edit/mix/version markers, named variants and
remaster years survive. Explicit primary-title versions cannot be erased by an
alternative title. Remaster versus original is conservatively a distinct recording.

Evidence includes title/artist/album scores, duration tier/delta, exact-source
association, overall confidence, validity, eligibility and reasons. Similarity is
60% token Dice + 40% Jaro-Winkler (never prefix similarity alone). Artist evidence
averages bidirectional coverage of source artist lists. Album disagreement lowers
confidence but does not alone reject a compilation/reissue of the same song.
Unknown album/duration does not fabricate agreement.

Duration tiers use absolute delta and track-relative bounds:

- excellent: <= max(2s, 1%); score 1
- acceptable: <= max(7s, 3%); score 0.9
- suspicious: <= max(15s, 8%); score 0.5
- reject: beyond that; score 0

Confidence weights: title 0.5, artist 0.35, album 0.05, duration 0.1, renormalized
over available evidence. Title <0.75, artist <0.8, conflicting versions or rejected
duration are hard contradictions. Confident requires title/artist >=0.9, overall

> =0.88 and nonsuspicious duration. `showLyricsEvenIfInexact` permits only the remaining
> borderline tier, never hard contradictions. Exact video association is authoritative
> despite translated/missing metadata; association with a different video rejects.

`search/ranking.ts` orders useful eligibility, confident versus inexact tier, actual
syllable > word > line > plain > none quality, 0.05 confidence bands, exact-source
evidence, global preferred provider, unrounded confidence and lexical provider/ID.
Claimed word/syllable without useful segments gets line quality. No provider-brand
bonuses. Global preference cannot override good synchronization or clearly better
identity. IDs make ties independent of response/completion order.

Store owns selection even when picker is not mounted. Manual/provider or variant
choice overrides automatic ranking for eligible candidates; star persists exact
variant when selected, otherwise provider intent. Legacy `{provider}` stars migrate
to explicit `{kind:'source', provider, candidateId:null}`. Unavailable/filtered
choices retain desired state while displaying a valid fallback. The original
provider carousel/dots/star UI remains; no extra variant selector or Auto button.
Arrow navigation skips sources without eligible useful lyrics, and is disabled
when fewer than two sources are available. White dot fill marks availability;
separate white outline marks the displayed source. Candidate variants and manual
Auto remain store APIs for future UI; Auto retains song star (star toggle clears it).

The picker is a clipped overlay outside the virtualized lyrics rows, with a
measured spacer at the start of the list. It hides after scrolling past its height
and fully reveals on pointer movement near the top of the lyrics viewport. Only
the panel transforms; showing/hiding never changes the list viewport geometry.

Global config `preferredProvider: 'auto' | ProviderName` has explicit Auto default.
Shared migration on menu/start safely normalizes missing/invalid/removed providers
and persists correction. None/Auto menu action writes `'auto'`, not undefined;
existing valid provider preferences survive. Electron restart test verifies actual
configuration merging cannot resurrect the former global provider after Auto.

## Lifecycle ownership

The application owns global song-info listeners; this plugin owns its scoped IPC
subscription, player listener, clock interval, DOM wait/header observers, search
session and Solid roots. `renderer/lifecycle.ts` cancels waits and disposes resources.
Stop removes only this plugin's IPC listener via a preload-owned disposer (never
all listeners on the shared channel). Header waits are replaced on track changes.
The disposer returned by Solid `render` is retained: stopping it executes component
`onCleanup`, including mouse/scroll listeners. Picker no longer needs a separate
player listener because selection belongs to the search/store. The module effect
root is explicitly started/disposed and recreated on reload. No discarded render
root or permanently disposed module owner is reused.
Romanization effect completions are detached on cleanup and failures logged. The
third-party shared Japanese dictionary initializer has no cancellation API; it
remains module-owned, not a per-track search or source of fabricated segment timing.

Follow-up: LyricsFile parsing can directly produce `LyricLine`/`LyricSegment`,
preserving source `start_ms`/`end_ms`. No LyricsFile parser or new provider is
introduced in this stage. Segment-level highlighting and translation display
remain separate renderer work; no live provider/UI validation is implied by
parser and mocked provider tests.
