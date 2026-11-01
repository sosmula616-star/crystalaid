import { REST, Routes, SlashCommandBuilder } from 'discord.js';

export const COMMANDS = [
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Задать вопрос поддержке'),
  new SlashCommandBuilder()
    .setName('menu')
    .setDescription('Меню настроек для администрации'),
  new SlashCommandBuilder()
    .setName('dev')
    .setDescription('Меню разработчика'),
].map((c) => c.toJSON());

/**
 * Registers the guild commands (an instant overwrite of the whole set). They belong to the guild,
 * so they exist on the server only; setContexts is for global commands and is not used.
 */
export async function registerCommands(token: string, clientId: string, guildId: string): Promise<number> {
  const rest = new REST({ version: '10' }).setToken(token);
  const res = (await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: COMMANDS })) as unknown[];
  return res.length;
}
