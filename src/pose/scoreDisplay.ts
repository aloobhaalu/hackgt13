import type { Assessment } from './types';

export const alignmentText = (a: Assessment) => a.score !== null ? `${a.score}%` : a.scoreStatus === 'ready' ? 'Ready' : '—';
export const holdTime = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
