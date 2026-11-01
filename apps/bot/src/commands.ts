import { InteractionContextType, REST, Routes, SlashCommandBuilder } from 'discord.js';

export const COMMANDS = [
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Задать вопрос поддержке')
    .setContexts(InteractionContextType.Guild),
  new SlashCommandBuilder()
    .setName('menu')
    .setDescription('Меню настроек для администрации')
    .setContexts(InteractionContextType.Guild),
  new SlashCommandBuilder()
    .setName('dev')
    .setDescription('Меню разработчика')
    .setContexts(InteractionContextType.Guild),
].map((c) => c.toJSON());

/** Registers the guild commands (an instant overwrite of the whole set). */
export async function registerCommands(token: string, clientId: string, guildId: string): Promise<number> {
  const rest = new REST({ version: '10' }).setToken(token);
  const res = (await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: COMMANDS })) as unknown[];
  return res.length;
}
