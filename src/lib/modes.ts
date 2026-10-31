import type { Variant } from './questions';

export interface Mode { key: string; title: string; desc: string; emoji: string; color: string; variants: Variant[]; typed?: boolean; rush?: number; n?: number; tag?: string }

export const MODES: Mode[] = [
  { key: 'shape', title: 'Shape Shifter', desc: 'Name countries from their silhouette', emoji: '◆', color: '#ffb547', variants: ['shape'], typed: true, tag: 'Core' },
  { key: 'flag', title: 'Flag Frenzy', desc: 'Flags both ways round', emoji: '⚑', color: '#ff6b5e', variants: ['flag', 'flag-rev'], typed: true, tag: 'Core' },
  { key: 'arms', title: 'Coat of Arms', desc: 'Heraldry, emblems and seals', emoji: '🛡️', color: '#e8c872', variants: ['arms'], typed: true, tag: 'Symbols' },
  { key: 'map', title: 'Pin It', desc: 'Find countries on the map', emoji: '⌖', color: '#53b8ff', variants: ['map-find', 'map-name'], tag: 'Core' },
  { key: 'capital', title: 'Capital Gains', desc: 'Capitals and their countries', emoji: '★', color: '#3ddc97', variants: ['capital', 'capital-rev'], tag: 'Core' },
  { key: 'hint', title: 'Clue Ladder', desc: 'Fewer clues, more points', emoji: '🕵️', color: '#b48cff', variants: ['hint'], n: 6, tag: 'Deduce' },
  { key: 'photo', title: 'Street Eye', desc: 'Real photos — where are you?', emoji: '📸', color: '#53b8ff', variants: ['photo'], typed: true, tag: 'Deduce' },
  { key: 'twist', title: 'Twisted Shapes', desc: 'Silhouettes, randomly rotated', emoji: '🌀', color: '#ff5d73', variants: ['shape-twist'], typed: true, tag: 'Hard' },
  { key: 'rush', title: 'Shape Rush', desc: '60 seconds. Go.', emoji: '⚡', color: '#ffb547', variants: ['shape', 'flag'], rush: 60, tag: 'Speed' },
  { key: 'mix', title: 'Grand Tour', desc: 'Everything, mixed', emoji: '🧭', color: '#3ddc97', variants: ['shape', 'flag', 'map-find', 'capital', 'photo', 'map-name', 'flag-rev', 'capital-rev', 'arms'], tag: 'Mixed' },
  { key: 'review', title: 'Smart Review', desc: 'Spaced repetition of fading memories', emoji: '🧠', color: '#b48cff', variants: ['shape'], tag: 'Memory' },
];
export const MODE_BY_KEY = Object.fromEntries(MODES.map((m) => [m.key, m]));
