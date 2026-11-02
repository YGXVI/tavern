// Кто управляет записью: MASTER_USER_IDS, роль MASTER_ROLE_ID,
// а если ничего не задано — участник с правом «Управлять сервером».
import { PermissionFlagsBits } from 'discord.js';

export function isMaster(member, cfg) {
  if (!member) return false;
  if (cfg.masterUserIds.includes(member.id)) return true;
  if (cfg.masterRoleId) return Boolean(member.roles?.cache?.has(cfg.masterRoleId));
  if (cfg.masterUserIds.length) return false;
  return Boolean(member.permissions?.has?.(PermissionFlagsBits.ManageGuild));
}
