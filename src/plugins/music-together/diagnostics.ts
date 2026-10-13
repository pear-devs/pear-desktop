import { Peer } from 'peerjs';

import { ICE_SERVERS } from './connection';

/**
 * Music Together connection diagnostics.
 *
 * Music Together relies on PeerJS (WebRTC). That does not work on every
 * network: strict/symmetric NATs, firewalls that block UDP or the STUN/TURN
 * ports, an unreachable signaling broker, or a downed relay all cause a
 * host/join to fail silently. These checks run entirely in the renderer using
 * the exact same {@link ICE_SERVERS} a real session uses, so the user can see
 * *why* a connection would fail before they try it.
 *
 * Nothing here needs a second peer — a throwaway {@link Peer} tests the
 * signaling broker, and self-contained {@link RTCPeerConnection}s gather ICE
 * candidates to probe STUN, TURN and the NAT type.
 */

export type CheckStatus = 'pass' | 'warn' | 'fail';
export type CheckId = 'signaling' | 'stun' | 'turn' | 'nat';

export type DiagnosticCheck = {
  id: CheckId;
  status: CheckStatus;
  /** Non-translatable specifics (public IP, NAT label, error code). */
  detail?: string;
};

export type NatType = 'open' | 'symmetric' | 'blocked' | 'unknown';
export type Verdict = 'good' | 'relay' | 'blocked' | 'no-signaling';

export type DiagnosticResult = {
  checks: DiagnosticCheck[];
  natType: NatType;
  verdict: Verdict;
  publicIp?: string;
  /** Plain-text, copyable technical summary for bug reports. */
  summary: string;
};

const urlsOf = (server: RTCIceServer): string[] =>
  Array.isArray(server.urls) ? server.urls : [server.urls];

const STUN_SERVERS = ICE_SERVERS.filter((server) =>
  urlsOf(server).every((url) => url.startsWith('stun:')),
);
const TURN_SERVERS = ICE_SERVERS.filter((server) =>
  urlsOf(server).some(
    (url) => url.startsWith('turn:') || url.startsWith('turns:'),
  ),
);

const SIGNALING_TIMEOUT = 8_000;
const STUN_TIMEOUT = 8_000;
const TURN_TIMEOUT = 10_000;

type SignalingResult = { ok: boolean; error?: string };

const testSignaling = (timeout = SIGNALING_TIMEOUT): Promise<SignalingResult> =>
  new Promise((resolve) => {
    let settled = false;
    let peer: Peer;
    try {
      peer = new Peer({
        debug: 0,
        config: {
          iceServers: ICE_SERVERS,
          sdpSemantics: 'unified-plan',
        },
      });
    } catch (err) {
      resolve({ ok: false, error: String(err) });
      return;
    }

    const finish = (result: SignalingResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        if (!peer.destroyed) peer.destroy();
      } catch {
        // ignore
      }
      resolve(result);
    };

    const timer = setTimeout(
      () => finish({ ok: false, error: 'timeout' }),
      timeout,
    );

    peer.on('open', () => finish({ ok: true }));
    peer.on('error', (err) => finish({ ok: false, error: err.type }));
  });

type SrflxMapping = {
  relatedPort: number;
  publicPort: number;
  publicIp: string;
};
type GatherResult = {
  hasHost: boolean;
  hasSrflx: boolean;
  hasRelay: boolean;
  srflx: SrflxMapping[];
  /** Distinct STUN server URLs that produced a reflexive candidate. */
  srflxServers: Set<string>;
  publicIp?: string;
  error?: string;
};

/**
 * Fallback parser for the raw candidate string, used when the structured
 * {@link RTCIceCandidate} fields are unavailable.
 *
 * `candidate:<foundation> <component> <transport> <priority> <address> <port>
 *  typ <type> [raddr <relatedAddr> rport <relatedPort> ...]`
 */
const parseCandidate = (candidate: string) => {
  const parts = candidate.split(' ');
  const typIndex = parts.indexOf('typ');
  const rportIndex = parts.indexOf('rport');
  return {
    address: parts[4],
    port: Number(parts[5]),
    type: typIndex >= 0 ? parts[typIndex + 1] : undefined,
    relatedPort: rportIndex >= 0 ? Number(parts[rportIndex + 1]) : 0,
  };
};

const gatherCandidates = (
  iceServers: RTCIceServer[],
  timeout: number,
  policy: RTCIceTransportPolicy = 'all',
): Promise<GatherResult> =>
  new Promise((resolve) => {
    const result: GatherResult = {
      hasHost: false,
      hasSrflx: false,
      hasRelay: false,
      srflx: [],
      srflxServers: new Set<string>(),
    };

    let pc: RTCPeerConnection;
    try {
      pc = new RTCPeerConnection({ iceServers, iceTransportPolicy: policy });
    } catch (err) {
      resolve({ ...result, error: String(err) });
      return;
    }

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        pc.close();
      } catch {
        // ignore
      }
      resolve(result);
    };
    const timer = setTimeout(finish, timeout);

    pc.onicecandidate = (event) => {
      const candidate = event.candidate;
      if (!candidate || !candidate.candidate) {
        finish(); // null candidate => gathering complete
        return;
      }

      const parsed = parseCandidate(candidate.candidate);
      const type = candidate.type ?? parsed.type;
      const address = candidate.address ?? parsed.address;
      const port = candidate.port ?? parsed.port;
      const relatedPort = candidate.relatedPort ?? parsed.relatedPort ?? 0;

      if (type === 'host') result.hasHost = true;
      if (type === 'relay') result.hasRelay = true;
      if (type === 'srflx') {
        result.hasSrflx = true;
        if (address) result.publicIp = address;
        // `url` (the server that produced this candidate) is populated by
        // Chromium but missing from the DOM typings.
        const url = (
          event as RTCPeerConnectionIceEvent & { url?: string | null }
        ).url;
        if (url) result.srflxServers.add(url);
        result.srflx.push({
          relatedPort,
          publicPort: port ?? 0,
          publicIp: address ?? '',
        });
      }
    };

    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === 'complete') finish();
    };

    try {
      pc.createDataChannel('music-together-diagnostics');
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .catch((err) => {
          result.error = String(err);
          finish();
        });
    } catch (err) {
      result.error = String(err);
      finish();
    }
  });

/**
 * Two-server NAT heuristic: the same local port is reflected by two different
 * STUN servers. If the public port differs per destination the NAT is
 * symmetric (direct P2P usually fails and a relay is required); if it stays
 * the same it is a cone (direct works).
 *
 * Confirming a cone requires responses from *two* servers — a single response
 * cannot rule out a symmetric NAT (the other server may just have timed out),
 * so a lone reply yields 'unknown' (which the verdict treats conservatively)
 * instead of a falsely reassuring 'open'.
 */
const classifyNat = (stun: GatherResult): NatType => {
  if (!stun.hasSrflx) {
    // No reflexive candidate at all: UDP or STUN is blocked on this network.
    return stun.hasHost ? 'blocked' : 'unknown';
  }

  const byLocalPort = new Map<number, Set<number>>();
  for (const mapping of stun.srflx) {
    const ports = byLocalPort.get(mapping.relatedPort) ?? new Set<number>();
    ports.add(mapping.publicPort);
    byLocalPort.set(mapping.relatedPort, ports);
  }

  const isSymmetric = Array.from(byLocalPort.values()).some(
    (ports) => ports.size > 1,
  );
  if (isSymmetric) return 'symmetric';

  // Not symmetric, but only trust 'open' once two independent STUN servers
  // have actually replied; otherwise we never verified the mapping.
  return stun.srflxServers.size >= 2 ? 'open' : 'unknown';
};

const natStatus = (natType: NatType): CheckStatus => {
  if (natType === 'open') return 'pass';
  if (natType === 'blocked') return 'fail';
  return 'warn';
};

const decideVerdict = (
  signaling: SignalingResult,
  stun: GatherResult,
  turn: GatherResult,
  natType: NatType,
): Verdict => {
  if (!signaling.ok) return 'no-signaling';
  if (stun.hasSrflx && natType === 'open') return 'good';
  if (turn.hasRelay) return 'relay';
  return 'blocked';
};

const buildSummary = (
  signaling: SignalingResult,
  stun: GatherResult,
  turn: GatherResult,
  natType: NatType,
  verdict: Verdict,
): string => {
  const yn = (ok: boolean) => (ok ? 'ok' : 'fail');
  return [
    'Music Together connection diagnostics',
    `- signaling broker: ${yn(signaling.ok)}${signaling.error ? ` (${signaling.error})` : ''}`,
    `- STUN (direct): ${yn(stun.hasSrflx)}${stun.publicIp ? ` (public ${stun.publicIp})` : ''}`,
    `- TURN (relay): ${yn(turn.hasRelay)}`,
    `- NAT type: ${natType}`,
    `- verdict: ${verdict}`,
  ].join('\n');
};

/**
 * Run all connection checks. `onUpdate` fires as each individual check resolves
 * so the UI can fill rows progressively; the returned promise resolves once
 * every check is done with the aggregated result.
 */
export const runDiagnostics = async (
  onUpdate?: (check: DiagnosticCheck) => void,
): Promise<DiagnosticResult> => {
  const emit = (check: DiagnosticCheck) => {
    onUpdate?.(check);
    return check;
  };

  const signalingP = testSignaling().then((result) => {
    emit({
      id: 'signaling',
      status: result.ok ? 'pass' : 'fail',
      detail: result.ok ? undefined : result.error,
    });
    return result;
  });

  const stunP = gatherCandidates(STUN_SERVERS, STUN_TIMEOUT).then((result) => {
    emit({
      id: 'stun',
      status: result.hasSrflx ? 'pass' : 'warn',
      detail: result.publicIp,
    });
    return result;
  });

  const turnP = gatherCandidates(TURN_SERVERS, TURN_TIMEOUT, 'relay').then(
    (result) => {
      emit({
        id: 'turn',
        status: result.hasRelay ? 'pass' : 'warn',
      });
      return result;
    },
  );

  const [signaling, stun, turn] = await Promise.all([signalingP, stunP, turnP]);

  const natType = classifyNat(stun);
  emit({ id: 'nat', status: natStatus(natType), detail: natType });

  const verdict = decideVerdict(signaling, stun, turn, natType);
  const checks: DiagnosticCheck[] = [
    {
      id: 'signaling',
      status: signaling.ok ? 'pass' : 'fail',
      detail: signaling.ok ? undefined : signaling.error,
    },
    {
      id: 'stun',
      status: stun.hasSrflx ? 'pass' : 'warn',
      detail: stun.publicIp,
    },
    { id: 'turn', status: turn.hasRelay ? 'pass' : 'warn' },
    { id: 'nat', status: natStatus(natType), detail: natType },
  ];

  return {
    checks,
    natType,
    verdict,
    publicIp: stun.publicIp,
    summary: buildSummary(signaling, stun, turn, natType, verdict),
  };
};
