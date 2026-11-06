// Запуск Discord-бота «Распутья»: npm start (настройки — .env, см. .env.example).
import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { loadConfig, loadDotEnv, validateConfig } from './config.js';
import { GuildController } from './core/controller.js';
import { isMaster } from './core/permissions.js';
import { CONSENT_NO, CONSENT_YES, consentRow } from './core/commands.js';
import { SessionStateError } from './recorder/session.js';

loadDotEnv();
let cfg;
try {
  cfg = validateConfig(loadConfig());
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
const controllers = new Map();
const controllerFor = (guild) => {
  if (!controllers.has(guild.id)) controllers.set(guild.id, new GuildController({ guild, cfg, log }));
  return controllers.get(guild.id);
};

const MASTER_ONLY = new Set(['join', 'leave', 'start', 'pause', 'resume', 'stop']);
const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral });

client.once(Events.ClientReady, (c) => {
  log(`Бот ${c.user.tag} запущен. Записи: ${cfg.recordingsDir}`);
  if (cfg.guildId && !c.guilds.cache.has(cfg.guildId)) log(`Внимание: бот не добавлен на сервер DISCORD_GUILD_ID=${cfg.guildId}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.inGuild()) return;
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === 'rec') await onRec(interaction);
    else if (interaction.isButton() && (interaction.customId === CONSENT_YES || interaction.customId === CONSENT_NO)) await onConsent(interaction);
  } catch (err) {
    const text = err instanceof SessionStateError ? err.message : `Ошибка: ${err.message}`;
    if (!(err instanceof SessionStateError)) log(err.stack || String(err));
    const reply = ephemeral(text);
    if (interaction.deferred || interaction.replied) await interaction.followUp(reply).catch(() => {});
    else await interaction.reply(reply).catch(() => {});
  }
});

async function onRec(interaction) {
  const sub = interaction.options.getSubcommand();
  const member = interaction.member;
  const ctl = controllerFor(interaction.guild);
  if (MASTER_ONLY.has(sub) && !isMaster(member, cfg)) {
    await interaction.reply(ephemeral('Управлять записью может только мастер.'));
    return;
  }
  const by = member.id;
  switch (sub) {
    case 'join': {
      const channel = member.voice?.channel;
      if (!channel) throw new SessionStateError('Сначала войдите в голосовой канал.');
      await interaction.deferReply();
      await interaction.editReply(await ctl.join(channel));
      return;
    }
    case 'leave':
      await interaction.reply(await ctl.leave(by));
      return;
    case 'start': {
      await interaction.deferReply();
      const channel = interaction.guild.channels.cache.get(ctl.channelId);
      const members = channel ? [...channel.members.values()] : [];
      await ctl.start({ by, members });
      await interaction.editReply({
        content: [
          `🔴 **Запись сессии начата** (<@${by}>).`,
          'Голос записывается **только у тех, кто нажал «Согласен на запись»**. Отказаться можно в любой момент.',
          'Записи хранятся только на компьютере, где работает бот, и нужны для транскрипта сессии.',
        ].join('\n'),
        components: [consentRow()],
      });
      return;
    }
    case 'pause':
      await ctl.pause(by);
      await interaction.reply('⏸ Запись на паузе.');
      return;
    case 'resume':
      await ctl.resume(by);
      await interaction.reply('🔴 Запись продолжена.');
      return;
    case 'stop': {
      const s = await ctl.stop(by);
      await interaction.reply(`⏹ Запись остановлена. Фрагментов: ${s.summary().segments}.`);
      return;
    }
    case 'status':
      await interaction.reply(ephemeral(ctl.status()));
      return;
    default:
      await interaction.reply(ephemeral('Неизвестная команда.'));
  }
}

async function onConsent(interaction) {
  const ctl = controllerFor(interaction.guild);
  if (!ctl.recording) {
    await interaction.reply(ephemeral('Сейчас запись не идёт.'));
    return;
  }
  const granted = interaction.customId === CONSENT_YES;
  await ctl.setConsent(interaction.member, granted);
  await interaction.reply(ephemeral(granted ? 'Спасибо: ваш голос записывается в этой сессии.' : 'Ваш голос не записывается.'));
}

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  if (newState.channelId === oldState.channelId) return;
  const ctl = controllers.get(newState.guild.id);
  if (!ctl || newState.member?.id === client.user.id) return;
  try {
    const result = await ctl.onVoiceMove(newState.member, newState.channelId, oldState.channelId);
    if (result === 'needs-consent') {
      const channel = newState.guild.channels.cache.get(newState.channelId);
      await channel?.send?.({
        content: `<@${newState.member.id}>, здесь идёт запись сессии. Ваш голос не записывается, пока вы не нажмёте «Согласен на запись».`,
        components: [consentRow()],
      }).catch(() => {});
    }
  } catch (err) {
    log(`voiceStateUpdate: ${err.message}`);
  }
});

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log(`${signal}: завершаю записи…`);
  await Promise.all([...controllers.values()].map((c) => c.shutdown()));
  await client.destroy();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

client.login(cfg.token);
