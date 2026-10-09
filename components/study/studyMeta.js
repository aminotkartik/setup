/**
 * Study Partner Finder labels. Client-safe: constants only, no data access.
 */

import { STUDY_AVAILABILITY, STUDY_MODES, STUDY_PURPOSES } from '@/lib/constants';

function labelFor(list, value) {
  return list.find((entry) => entry.value === value)?.label || value;
}

export function purposeLabel(value) {
  return labelFor(STUDY_PURPOSES, value);
}

export function modeLabel(value) {
  return labelFor(STUDY_MODES, value);
}

export function availabilityLabel(value) {
  return labelFor(STUDY_AVAILABILITY, value);
}
