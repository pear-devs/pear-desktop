import { createRequire } from 'node:module';

import { expect, test } from '@playwright/test';

const require = createRequire(import.meta.url);
const protocol = require('castv2/lib/proto') as {
  CastMessage: {
    serialize: (message: Record<string, unknown>) => Uint8Array;
    parse: (message: Uint8Array) => { payloadUtf8: string };
  };
};

test('patched protobufjs encodes and decodes Cast messages', async () => {
  const message = {
    protocolVersion: 0,
    sourceId: 'sender-0',
    destinationId: 'receiver-0',
    namespace: 'urn:x-cast:com.google.cast.tp.heartbeat',
    payloadType: 0,
    payloadUtf8: '{"type":"PING"}',
  };

  // castv2 loads its protobuf schema asynchronously when required.
  await expect
    .poll(() => {
      try {
        return protocol.CastMessage.serialize(message);
      } catch (error) {
        if ((error as Error).message === 'extension not loaded yet')
          return null;
        throw error;
      }
    })
    .not.toBeNull();

  const encoded = protocol.CastMessage.serialize(message);
  expect(protocol.CastMessage.parse(encoded).payloadUtf8).toBe(
    message.payloadUtf8,
  );
});
