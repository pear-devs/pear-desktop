import { copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const castPackageEntry = fileURLToPath(import.meta.resolve('castv2'));
const source = join(dirname(castPackageEntry), 'lib', 'cast_channel.proto');
const target = join(import.meta.dirname, '..', 'dist', 'main', 'cast_channel.proto');
copyFileSync(source, target);
