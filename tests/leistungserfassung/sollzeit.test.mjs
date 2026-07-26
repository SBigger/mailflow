import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  calcSollHours,
  pickProfile,
  sollForDay,
  toHolidaySet,
} from '../../src/components/auswertungen/util.js';

test('pickProfile does not apply a future/latest profile retrospectively', () => {
  const profiles = [
    { id: 'future', valid_from: '2027-01-01', valid_to: null },
    { id: 'current', valid_from: '2026-01-01', valid_to: '2026-12-31' },
  ];
  assert.equal(pickProfile(profiles, '2026-06-01')?.id, 'current');
  assert.equal(pickProfile(profiles, '2025-06-01'), null);
});

test('holiday filtering respects canton plus national holidays', () => {
  const holidays = [
    { date: '2026-08-01', canton: '*' },
    { date: '2026-09-22', canton: 'SG' },
    { date: '2026-09-28', canton: 'ZH' },
  ];
  const sg = toHolidaySet(holidays, 'SG');
  assert.equal(sg.has('2026-08-01'), true);
  assert.equal(sg.has('2026-09-22'), true);
  assert.equal(sg.has('2026-09-28'), false);
});

test('soll time inherits template, applies pensum and zeroes holidays', () => {
  const templates = [{
    valid_from: '2026-01-01',
    valid_to: null,
    hours_mo: 8,
    hours_di: 8,
    hours_mi: 8,
    hours_do: 8,
    hours_fr: 8,
    hours_sa: 0,
    hours_so: 0,
  }];
  const profiles = [{
    valid_from: '2026-01-01',
    valid_to: null,
    pensum_pct: 50,
    hours_mo: null,
    hours_di: 6,
  }];
  const holidays = new Set(['2026-07-08']);

  assert.equal(sollForDay(templates, profiles, holidays, '2026-07-06'), 4);
  assert.equal(sollForDay(templates, profiles, holidays, '2026-07-07'), 6);
  assert.equal(sollForDay(templates, profiles, holidays, '2026-07-08'), 0);
  assert.equal(calcSollHours(
    templates,
    profiles,
    holidays,
    '2026-07-06',
    '2026-07-12',
  ), 18);
});
