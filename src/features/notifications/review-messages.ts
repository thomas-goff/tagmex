import 'server-only';
import { db } from '@/db';
import { editMessage } from './discord';
import { createReviewMessages } from './review';

export const reviewMessages = createReviewMessages(db, editMessage);
