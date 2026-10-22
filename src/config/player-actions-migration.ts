type RawRecord = Record<string, unknown>;

export const LEGACY_SLOWED_REVERB_PLUGIN_ID = 'slowed-reverb';
export const LEGACY_SECTION_REPEAT_PLUGIN_ID = 'section-repeat';

const SLOWED_REVERB_FIELDS = ['slow', 'reverbIntensity'] as const;

function isRecord(value: unknown): value is RawRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(record: RawRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function getLegacyActive(value: RawRecord): unknown {
  if (value.enabled === false) return false;
  if (value.enabled === true) return value.active !== false;
  return hasOwn(value, 'active') ? value.active : undefined;
}

/**
 * Move the persisted settings from the former standalone player plugins into
 * the merged player-actions plugin. The stored record is JSON data, but the
 * guards keep malformed entries from making startup fail.
 */
export function migratePlayerActionsPlugins(rawPlugins: unknown): RawRecord {
  if (!isRecord(rawPlugins)) return {};

  const plugins = { ...rawPlugins };
  const hasSlowedReverb = hasOwn(rawPlugins, LEGACY_SLOWED_REVERB_PLUGIN_ID);
  const hasSectionRepeat = hasOwn(rawPlugins, LEGACY_SECTION_REPEAT_PLUGIN_ID);

  if (!hasSlowedReverb && !hasSectionRepeat) return plugins;

  const oldSlowedReverb = isRecord(rawPlugins[LEGACY_SLOWED_REVERB_PLUGIN_ID])
    ? rawPlugins[LEGACY_SLOWED_REVERB_PLUGIN_ID]
    : undefined;
  const oldSectionRepeat = isRecord(rawPlugins[LEGACY_SECTION_REPEAT_PLUGIN_ID])
    ? rawPlugins[LEGACY_SECTION_REPEAT_PLUGIN_ID]
    : undefined;
  const currentRecord = isRecord(rawPlugins['player-actions'])
    ? rawPlugins['player-actions']
    : undefined;
  const current = currentRecord ? { ...currentRecord } : {};
  let shouldSetCurrent = currentRecord !== undefined;

  if (
    typeof current.enabled !== 'boolean' &&
    (oldSlowedReverb?.enabled === true || oldSectionRepeat?.enabled === true)
  ) {
    current.enabled = true;
    shouldSetCurrent = true;
  }

  const currentSlowedReverb = isRecord(current.slowedReverb)
    ? { ...current.slowedReverb }
    : {};
  let shouldSetSlowedReverb = isRecord(current.slowedReverb);
  for (const field of SLOWED_REVERB_FIELDS) {
    if (
      !hasOwn(currentSlowedReverb, field) &&
      oldSlowedReverb &&
      hasOwn(oldSlowedReverb, field)
    ) {
      currentSlowedReverb[field] = oldSlowedReverb[field];
      shouldSetSlowedReverb = true;
    }
  }
  if (
    !hasOwn(currentSlowedReverb, 'active') &&
    oldSlowedReverb &&
    getLegacyActive(oldSlowedReverb) !== undefined
  ) {
    currentSlowedReverb.active = getLegacyActive(oldSlowedReverb);
    shouldSetSlowedReverb = true;
  }
  if (shouldSetSlowedReverb) {
    current.slowedReverb = currentSlowedReverb;
    shouldSetCurrent = true;
  }

  const currentSectionRepeat = isRecord(current.sectionRepeat)
    ? { ...current.sectionRepeat }
    : {};
  let shouldSetSectionRepeat = isRecord(current.sectionRepeat);
  if (
    !hasOwn(currentSectionRepeat, 'active') &&
    oldSectionRepeat &&
    getLegacyActive(oldSectionRepeat) !== undefined
  ) {
    currentSectionRepeat.active = getLegacyActive(oldSectionRepeat);
    shouldSetSectionRepeat = true;
  }
  if (shouldSetSectionRepeat) {
    current.sectionRepeat = currentSectionRepeat;
    shouldSetCurrent = true;
  }

  if (shouldSetCurrent) plugins['player-actions'] = current;
  delete plugins[LEGACY_SLOWED_REVERB_PLUGIN_ID];
  delete plugins[LEGACY_SECTION_REPEAT_PLUGIN_ID];
  return plugins;
}
