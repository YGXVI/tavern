// Slash-команда /rec и кнопки согласия.
import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

export const CONSENT_YES = 'rec:consent:yes';
export const CONSENT_NO = 'rec:consent:no';

export const SUBCOMMANDS = Object.freeze({
  join: 'Подключить бота к вашему голосовому каналу',
  leave: 'Отключить бота (запись будет остановлена)',
  start: 'Начать запись (пишутся только согласившиеся)',
  pause: 'Поставить запись на паузу',
  resume: 'Продолжить запись',
  stop: 'Остановить запись',
  status: 'Состояние записи',
});

export function buildCommands() {
  const rec = new SlashCommandBuilder()
    .setName('rec')
    .setDescription('Запись игровой сессии «Распутья»')
    .setDMPermission(false);
  for (const [name, description] of Object.entries(SUBCOMMANDS)) {
    rec.addSubcommand((s) => s.setName(name).setDescription(description));
  }
  return [rec.toJSON()];
}

export function consentRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(CONSENT_YES).setLabel('Согласен на запись').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(CONSENT_NO).setLabel('Не записывать меня').setStyle(ButtonStyle.Secondary),
  );
}
