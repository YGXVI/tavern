// Регистрация /rec на тестовом сервере (появляется сразу): npm run register
import { REST, Routes } from 'discord.js';
import { loadConfig, loadDotEnv, validateConfig } from '../src/config.js';
import { buildCommands } from '../src/core/commands.js';

loadDotEnv();
const cfg = validateConfig(loadConfig(), ['token', 'clientId', 'guildId']);
const rest = new REST().setToken(cfg.token);
const body = buildCommands();
await rest.put(Routes.applicationGuildCommands(cfg.clientId, cfg.guildId), { body });
console.log(`Зарегистрировано команд: ${body.length} на сервере ${cfg.guildId}.`);
