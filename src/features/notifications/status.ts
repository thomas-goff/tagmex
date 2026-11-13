import 'server-only';
import { db } from '@/db';
import { budget } from '@/features/budget';
import { postMessage } from './discord';
import { createStatusPostLog, createStatusPoster } from './status-post';

export const statusPoster = createStatusPoster({ budget, post: (channel, payload) => postMessage(channel, payload), log: createStatusPostLog(db) });
