import { test, expect } from '@playwright/test';

import {
  comparisonText,
  durationEvidence,
  matchCandidate,
  normalizeTitle,
  versionMarkers,
} from './matching';
import { rankCandidates, selectCandidate, syncQuality } from './ranking';

import type { LyricCandidate, SearchSongInfo, SyncLevel } from '../types';

const track: SearchSongInfo = {
  videoId: 'video',
  title: 'Northern Lights',
  artist: 'Aurora',
  album: 'Sky',
  songDuration: 200,
};
const candidate = (
  provider = 'p',
  syncLevel: SyncLevel = 'line',
  id = 'one',
): LyricCandidate => ({
  provider,
  id,
  sourceId: id,
  album: 'Sky',
  durationMs: 200000,
  result: {
    title: track.title,
    artists: [track.artist],
    syncLevel,
    ...(syncLevel === 'plain'
      ? { lyrics: '  Hello! 世界 ' }
      : {
          lines: [
            {
              text: '  Hello! 世界 ',
              startMs: 0,
              endMs: 200000,
              ...(syncLevel === 'word' || syncLevel === 'syllable'
                ? {
                    segments: [
                      { text: '  Hello! 世界 ', startMs: 0, endMs: 1000 },
                    ],
                  }
                : {}),
            },
          ],
        }),
  },
});

test('exact title/artist retains originals and explains component evidence', () => {
  const source = candidate();
  const evidence = matchCandidate(track, source);
  expect(evidence).toMatchObject({
    titleScore: 1,
    artistScore: 1,
    albumScore: 1,
    confidence: 1,
    validity: 'confident',
    eligible: true,
    exactSource: false,
    reasons: [],
  });
  expect(source.result.lines![0].text).toBe('  Hello! 世界 ');
  expect(comparisonText('  AURORA—Ｓｋｙ! ')).toBe('aurora sky');
  expect(normalizeTitle('Northern Lights [Official Music Video]')).toBe(
    'northern lights',
  );
});

test('alternative title is common evidence, not a provider exception', () => {
  const source = candidate();
  source.result.title = '北の光';
  expect(
    matchCandidate({ ...track, alternativeTitle: '北の光' }, source),
  ).toMatchObject({ titleScore: 1, titleUsed: '北の光', eligible: true });
  expect(matchCandidate(track, source).eligible).toBe(false);
});

for (const [field, value, reason] of [
  ['title', 'Another Song', 'title mismatch'],
  ['artists', ['Unrelated Artist'], 'artist mismatch'],
] as const) {
  test(`wrong ${field} rejected even with inexact enabled`, () => {
    const source = candidate('p', 'word');
    if (field === 'title') source.result.title = value as string;
    else source.result.artists = [...(value as readonly string[])];
    const evidence = matchCandidate(track, source, true);
    expect(evidence.eligible).toBe(false);
    expect(evidence.reasons).toContain(reason);
  });
}

test('album disagreement reduces evidence but does not reject same recording alone', () => {
  const source = candidate();
  const agree = matchCandidate(track, source);
  source.album = 'Compilation';
  const disagree = matchCandidate(track, source);
  expect(disagree.albumScore).toBeLessThan(agree.albumScore!);
  expect(disagree.confidence).toBeLessThan(agree.confidence);
  expect(disagree.eligible).toBe(true);
});

for (const [deltaMs, quality] of [
  [1000, 'excellent'],
  [6000, 'acceptable'],
  [14000, 'suspicious'],
  [30000, 'reject'],
] as const) {
  test(`duration ${quality} has deterministic tier and acceptance`, () => {
    expect(durationEvidence(200000, 200000 + deltaMs).quality).toBe(quality);
    const source = candidate();
    source.durationMs! += deltaMs;
    expect(matchCandidate(track, source).eligible).toBe(
      quality === 'excellent' || quality === 'acceptable',
    );
    expect(matchCandidate(track, source, true).eligible).toBe(
      quality !== 'reject',
    );
  });
}
test('duration thresholds scale with track length; absence never fabricates duration', () => {
  expect(durationEvidence(1000000, 1009000).quality).toBe('excellent');
  expect(durationEvidence(0, 200)).toEqual({ quality: 'unknown' });
  expect(durationEvidence(200000)).toEqual({ quality: 'unknown' });
});

test('allow-inexact is shared and permits borderline evidence, never known recording contradictions', () => {
  const source = candidate();
  source.result.title += ' Bonus';
  expect(matchCandidate(track, source).validity).toBe('inexact');
  expect(matchCandidate(track, source).eligible).toBe(false);
  expect(matchCandidate(track, source, true).eligible).toBe(true);
});

for (const version of [
  'Live',
  'Remix',
  '2011 Remastered',
  'Acoustic',
  'Instrumental',
  'Karaoke',
  'Sped Up',
  'Slowed',
  'Radio Edit',
  'Club Mix',
  'Extended Version',
]) {
  test(`recording distinction retained: ${version}`, () => {
    const source = candidate();
    source.result.title += ` (${version})`;
    expect(versionMarkers(source.result.title).length).toBeGreaterThan(0);
    expect(matchCandidate(track, source, true)).toMatchObject({
      eligible: false,
      reasons: expect.arrayContaining(['recording/version mismatch']),
    });
    expect(
      matchCandidate({ ...track, title: source.result.title }, source).eligible,
    ).toBe(true);
    expect(normalizeTitle(source.result.title)).toContain(
      comparisonText(version),
    );
  });
}
test('named mix and remaster year are recording evidence, not removable noise', () => {
  const source = candidate();
  source.result.title = 'Northern Lights (Club Mix)';
  expect(
    matchCandidate(
      { ...track, title: 'Northern Lights (Radio Mix)' },
      source,
      true,
    ).eligible,
  ).toBe(false);
  source.result.title = 'Northern Lights (2020 Remastered)';
  expect(
    matchCandidate(
      { ...track, title: 'Northern Lights (2011 Remastered)' },
      source,
      true,
    ).eligible,
  ).toBe(false);
});

test('bare named remixes remain distinct and alternative title cannot erase live identity', () => {
  const source = candidate();
  source.result.title = 'Northern Lights Tiesto Remix';
  expect(
    matchCandidate(
      { ...track, title: 'Northern Lights Club Remix' },
      source,
      true,
    ).eligible,
  ).toBe(false);
  source.result.title = 'Northern Lights';
  expect(
    matchCandidate(
      {
        ...track,
        title: 'Northern Lights (Live)',
        alternativeTitle: 'Northern Lights',
      },
      source,
      true,
    ).eligible,
  ).toBe(false);
});

test('exact source association is actual evidence, no provider brand bonus', () => {
  const source = candidate('not-YTMusic');
  source.exactVideoId = track.videoId;
  source.result.title = 'Translated title';
  source.result.artists = [];
  expect(matchCandidate(track, source)).toMatchObject({
    exactSource: true,
    confidence: 1,
    eligible: true,
  });
  source.exactVideoId = 'another-video';
  expect(matchCandidate(track, source, true)).toMatchObject({
    exactSource: false,
    eligible: false,
    reasons: expect.arrayContaining(['different source video']),
  });
});

test('useful sync hierarchy is syllable > word > line > plain > none', () => {
  const values = [
    candidate('p', 'plain', 'plain'),
    candidate('p', 'line', 'line'),
    candidate('p', 'word', 'word'),
    candidate('p', 'syllable', 'syllable'),
  ];
  const empty = candidate('p', 'plain', 'empty');
  empty.result.lyrics = ' ';
  expect(
    rankCandidates(track, [...values, empty]).map(
      ({ candidate: item }) => item.id,
    ),
  ).toEqual(['syllable', 'word', 'line', 'plain', 'empty']);
  const fakeWord = candidate('p', 'word');
  delete fakeWord.result.lines![0].segments;
  expect(syncQuality(fakeWord)).toBe(2);
});
test('confident line beats wrong-song word and inexact richer timing', () => {
  const wrong = candidate('p', 'word', 'wrong');
  wrong.result.artists = ['Wrong'];
  const suspicious = candidate('p', 'syllable', 'suspicious');
  suspicious.durationMs = 214000;
  const exact = candidate('p', 'line', 'exact');
  const ranked = rankCandidates(track, [wrong, suspicious, exact], {
    allowInexact: true,
  });
  expect(ranked[0].candidate.id).toBe('exact');
  expect(
    ranked.find((item) => item.candidate.id === 'wrong')!.evidence.eligible,
  ).toBe(false);
});
test('global preferred plain cannot beat valid synchronized match', () => {
  expect(
    rankCandidates(
      track,
      [candidate('preferred', 'plain'), candidate('other', 'line')],
      { preferredProvider: 'preferred' },
    )[0].candidate.provider,
  ).toBe('other');
});
test('global preferred synchronized wins comparable synchronized tie, not exact-source evidence', () => {
  const other = candidate('other');
  const preferred = candidate('preferred');
  expect(
    rankCandidates(track, [other, preferred], {
      preferredProvider: 'preferred',
    })[0].candidate.provider,
  ).toBe('preferred');
  other.exactVideoId = track.videoId;
  expect(
    rankCandidates(track, [other, preferred], {
      preferredProvider: 'preferred',
    })[0].candidate.provider,
  ).toBe('other');
});
test('multiple candidates per provider retained and ties independent of completion/input order', () => {
  const a = candidate('p', 'line', 'a');
  const b = candidate('p', 'line', 'b');
  const c = candidate('q', 'line', 'a');
  const ids = (values: LyricCandidate[]) =>
    rankCandidates(track, values).map(
      ({ candidate: item }) => `${item.provider}:${item.id}`,
    );
  expect(ids([c, b, a])).toEqual(['p:a', 'p:b', 'q:a']);
  expect(ids([a, c, b])).toEqual(ids([c, b, a]));
});
test('explicit per-song selection overrides sync preference but not match rejection', () => {
  const plain = candidate('p', 'plain');
  const line = candidate('q');
  const ranked = rankCandidates(track, [plain, line]);
  expect(
    selectCandidate(ranked, {
      kind: 'source',
      provider: 'p',
      candidateId: 'one',
    }).selected?.candidate,
  ).toBe(plain);
  plain.result.title = 'Wrong song';
  const selection = selectCandidate(rankCandidates(track, [plain, line]), {
    kind: 'source',
    provider: 'p',
    candidateId: 'one',
  });
  expect(selection.selected?.candidate).toBe(line);
  expect(selection.unavailableChoice).toBe(true);
});
test('unavailable explicit variant/provider falls back and retains desired choice', () => {
  const choice = {
    kind: 'source',
    provider: 'p',
    candidateId: 'missing',
  } as const;
  const ranked = rankCandidates(track, [candidate('p'), candidate('q')]);
  const selection = selectCandidate(ranked, choice);
  expect(selection.selected).toBe(ranked[0]);
  expect(selection.choice).toBe(choice);
  expect(selection.unavailableChoice).toBe(true);
  expect(selectCandidate([], choice)).toMatchObject({
    selected: undefined,
    choice,
    unavailableChoice: true,
  });
  expect(
    selectCandidate(ranked, { ...choice, candidateId: null }).unavailableChoice,
  ).toBe(false);
});
