import { CommandError, type Commands } from '@/features/commands/commands';
import { MASTER } from './embeds';
import type { InteractionReply } from './discord';
import { confirmComponents, parseReviewAction, type ReviewAction } from './review-components';

// Clicks on the #needs-review controls, as Discord delivers them to /api/discord/interactions
// (signature already checked). Discord wants an answer within 3 seconds, so the answer is "update
// coming" and the work runs after it: categorising or excluding edits the review message itself
// (through ReviewMessages.resolve), and anything else to say is a reply only the clicker sees.

export interface Interaction {
  type: number;
  application_id: string;
  token: string;
  data?: { custom_id?: string; values?: string[] };
  member?: { user?: { id: string } };
  user?: { id: string };
}

export interface InteractionDeps {
  // The Discord user whose clicks count (DISCORD_PING_USER_ID). Unset = nobody's.
  ownerDiscordId: string | undefined;
  // The app user a transaction's review message was posted for, or null when it has none.
  reviewOwner(transactionId: string): Promise<string | null>;
  commands: Pick<Commands, 'categorise' | 'exclude'>;
  followUp(applicationId: string, token: string, reply: InteractionReply): Promise<void>;
  editOriginal(applicationId: string, token: string, reply: InteractionReply): Promise<void>;
  log?: Pick<Console, 'error'>;
}

export interface InteractionResult {
  // The immediate answer to Discord.
  response: object;
  // Runs after the answer is sent.
  work?: () => Promise<void>;
}

const PING = 1;
const MESSAGE_COMPONENT = 3;
const PONG = 1;
const CHANNEL_MESSAGE = 4;
const DEFERRED_UPDATE_MESSAGE = 6;
const EPHEMERAL = 64;

const say = (content: string) => ({ type: CHANNEL_MESSAGE, data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] } } });

export function handleInteraction(interaction: Interaction, deps: InteractionDeps): InteractionResult {
  if (interaction.type === PING) return { response: { type: PONG } };
  if (interaction.type !== MESSAGE_COMPONENT) return { response: say("I'm afraid I don't know that one, sir.") };

  const clicker = interaction.member?.user?.id ?? interaction.user?.id;
  if (!deps.ownerDiscordId || clicker !== deps.ownerDiscordId) {
    return { response: say(`Only ${MASTER} may sort the ledger, I'm afraid.`) };
  }
  const action = parseReviewAction(interaction.data?.custom_id ?? '', interaction.data?.values);
  if (!action) return { response: say("I don't recognise that control, sir.") };

  return { response: { type: DEFERRED_UPDATE_MESSAGE }, work: () => perform(action, interaction, deps) };
}

async function perform(action: ReviewAction, { application_id: appId, token }: Interaction, deps: InteractionDeps) {
  const reply = (content: string, components?: InteractionReply['components']) =>
    deps.followUp(appId, token, { content, components }).catch((err) => (deps.log ?? console).error('replying to a Discord click failed', err));
  try {
    const userId = await deps.reviewOwner(action.transactionId);
    if (!userId) return await reply("I can't find that transaction among the ones awaiting review, sir.");

    if (action.kind === 'exclude') {
      await deps.commands.exclude(userId, action.transactionId);
      return;
    }

    const result = await deps.commands.categorise(userId, {
      transactionId: action.transactionId,
      category: action.categoryId,
      applyToSimilar: true,
      confirm: action.kind === 'confirm',
    });
    if (result.status === 'needs_confirmation') {
      const count = result.wouldAlsoChange + 1;
      return await reply(
        `That would file ${count} transactions like this one as ${result.category.name}, sir. Shall I?`,
        confirmComponents(action.transactionId, { id: result.category.id, name: result.category.name, emoji: null }, count),
      );
    }
    // The confirm button sits on that reply: say it's done there.
    if (action.kind === 'confirm') {
      await deps.editOriginal(appId, token, { content: `✅ Filed ${1 + result.appliedTo} as ${result.category.name}, sir.`, components: [] });
    }
  } catch (err) {
    if (err instanceof CommandError) return await reply(err.message);
    (deps.log ?? console).error('a #needs-review click failed', err);
    await reply("Something went wrong filing that, sir. Do try again, or ask Claude.");
  }
}
