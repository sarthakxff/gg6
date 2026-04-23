require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, REST, Routes } = require('discord.js');
const MonitorManager = require('./MonitorManager');
const config = require('./config');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const monitor = new MonitorManager();

// ─── Register Slash Commands ───────────────────────────────────────────────
const commands = [
  new SlashCommandBuilder()
    .setName('add')
    .setDescription('Add an Instagram account to monitor (max 10)')
    .addStringOption(opt =>
      opt.setName('username').setDescription('Instagram username (without @)').setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('label').setDescription('Optional label/nickname for this account').setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Remove an Instagram account from monitoring')
    .addStringOption(opt =>
      opt.setName('username').setDescription('Instagram username to remove').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Check the current status of all monitored accounts'),

  new SlashCommandBuilder()
    .setName('check')
    .setDescription('Force an immediate check on a specific account')
    .addStringOption(opt =>
      opt.setName('username').setDescription('Instagram username to check').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('interval')
    .setDescription('Set the monitoring check interval in minutes')
    .addIntegerOption(opt =>
      opt.setName('minutes').setDescription('Interval in minutes (1–60)').setRequired(true).setMinValue(1).setMaxValue(60)
    ),

  new SlashCommandBuilder()
    .setName('setchannel')
    .setDescription('Set this channel as the alert destination for status changes'),

  new SlashCommandBuilder()
    .setName('list')
    .setDescription('List all monitored accounts'),

  new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Remove ALL monitored accounts'),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show all available commands'),
].map(cmd => cmd.toJSON());

async function registerCommands() {
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    console.log('🔄 Registering slash commands...');
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    console.log('✅ Slash commands registered.');
  } catch (err) {
    console.error('❌ Failed to register commands:', err.message);
  }
}

// ─── Bot Ready ─────────────────────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`\n🤖 Bot online as ${client.user.tag}`);
  console.log(`📡 Monitoring interval: ${config.checkIntervalMinutes} min`);
  client.user.setPresence({
    activities: [{ name: '📸 Instagram accounts', type: 3 }],
    status: 'online',
  });

  await registerCommands();

  // Start the background monitor loop
  monitor.startLoop(async (event) => {
    await handleMonitorEvent(event);
  });

  console.log('🚀 Monitor loop started.\n');
});

// ─── Handle monitor events (status changes) ────────────────────────────────
async function handleMonitorEvent(event) {
  const alertChannelId = monitor.getAlertChannel();
  if (!alertChannelId) return;

  const channel = await client.channels.fetch(alertChannelId).catch(() => null);
  if (!channel) return;

  const embed = buildStatusEmbed(event);
  await channel.send({ embeds: [embed] }).catch(console.error);
}

// ─── Interaction Handler ────────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;
  await interaction.deferReply();

  try {
    switch (commandName) {

      case 'add': {
        const username = interaction.options.getString('username').replace('@', '').trim().toLowerCase();
        const label = interaction.options.getString('label') || username;
        const result = await monitor.addAccount(username, label);
        const embed = result.success
          ? successEmbed(`✅ Added **@${username}**`, `Now monitoring **${monitor.getCount()}/${config.maxAccounts}** accounts.\nLabel: \`${label}\`\nChecking every **${monitor.getInterval()} min**.`)
          : errorEmbed('❌ Could not add account', result.message);
        await interaction.editReply({ embeds: [embed] });
        break;
      }

      case 'remove': {
        const username = interaction.options.getString('username').replace('@', '').trim().toLowerCase();
        const result = monitor.removeAccount(username);
        const embed = result.success
          ? successEmbed(`🗑️ Removed **@${username}**`, `${monitor.getCount()} accounts remaining.`)
          : errorEmbed('❌ Not found', result.message);
        await interaction.editReply({ embeds: [embed] });
        break;
      }

      case 'status': {
        const embed = await buildFullStatusEmbed(monitor);
        await interaction.editReply({ embeds: [embed] });
        break;
      }

      case 'check': {
        const username = interaction.options.getString('username').replace('@', '').trim().toLowerCase();
        await interaction.editReply({ embeds: [infoEmbed(`🔍 Checking **@${username}**...`, 'This may take a few seconds.')] });
        const result = await monitor.forceCheck(username);
        const embed = result.success
          ? buildStatusEmbed({ ...result, forced: true })
          : errorEmbed('❌ Check failed', result.message);
        await interaction.followUp({ embeds: [embed] });
        break;
      }

      case 'interval': {
        const minutes = interaction.options.getInteger('minutes');
        monitor.setInterval(minutes);
        await interaction.editReply({ embeds: [successEmbed(`⏱️ Interval updated`, `Checking every **${minutes} minute(s)**.`)] });
        break;
      }

      case 'setchannel': {
        monitor.setAlertChannel(interaction.channelId);
        await interaction.editReply({ embeds: [successEmbed(`📢 Alert channel set`, `Status change alerts will be sent to <#${interaction.channelId}>.`)] });
        break;
      }

      case 'list': {
        const accounts = monitor.getAccounts();
        if (accounts.length === 0) {
          await interaction.editReply({ embeds: [infoEmbed('📋 No accounts monitored', 'Use `/add <username>` to start monitoring.')] });
        } else {
          const lines = accounts.map((a, i) =>
            `\`${i + 1}.\` **@${a.username}** (${a.label}) — ${statusIcon(a.status)} ${a.status || 'Pending'}`
          ).join('\n');
          await interaction.editReply({ embeds: [infoEmbed(`📋 Monitored Accounts (${accounts.length}/${config.maxAccounts})`, lines)] });
        }
        break;
      }

      case 'clear': {
        monitor.clearAll();
        await interaction.editReply({ embeds: [successEmbed('🧹 All accounts cleared', 'Monitoring list is now empty.')] });
        break;
      }

      case 'help': {
        await interaction.editReply({ embeds: [buildHelpEmbed()] });
        break;
      }
    }
  } catch (err) {
    console.error(`[CMD ERROR] ${commandName}:`, err.message);
    await interaction.editReply({ embeds: [errorEmbed('⚠️ Unexpected error', err.message)] }).catch(() => {});
  }
});

// ─── Embed Builders ─────────────────────────────────────────────────────────
function statusIcon(status) {
  if (status === 'ACTIVE') return '🟢';
  if (status === 'BANNED') return '🔴';
  return '🟡';
}

function buildStatusEmbed(event) {
  const isActive = event.status === 'ACTIVE';
  const color = isActive ? 0x00e676 : 0xff1744;
  const icon = isActive ? '🟢' : '🔴';
  const title = isActive
    ? `${icon} Account Active — @${event.username}`
    : `${icon} Account Banned — @${event.username}`;
  const desc = isActive
    ? `✅ **Account is ACTIVE**\n📡 Monitoring for ban...`
    : `⛔ **Account is BANNED / Inactive**\n🔄 Monitoring for unban...`;

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(desc)
    .setColor(color)
    .setTimestamp()
    .setFooter({ text: 'Instagram Monitor Bot' });

  if (event.label && event.label !== event.username) embed.addFields({ name: 'Label', value: event.label, inline: true });
  if (event.forced) embed.addFields({ name: 'Triggered by', value: 'Manual check', inline: true });
  if (event.previousStatus && event.previousStatus !== event.status) {
    embed.addFields({ name: 'Previous Status', value: `${statusIcon(event.previousStatus)} ${event.previousStatus}`, inline: true });
  }
  if (event.checkedAt) embed.addFields({ name: 'Checked at', value: `<t:${Math.floor(event.checkedAt / 1000)}:R>`, inline: true });

  return embed;
}

async function buildFullStatusEmbed(monitor) {
  const accounts = monitor.getAccounts();
  const embed = new EmbedBuilder()
    .setTitle('📊 Instagram Monitor — Status Dashboard')
    .setColor(0x5865f2)
    .setTimestamp()
    .setFooter({ text: `Monitoring ${accounts.length}/${config.maxAccounts} accounts • Interval: ${monitor.getInterval()} min` });

  if (accounts.length === 0) {
    embed.setDescription('No accounts are being monitored.\nUse `/add <username>` to start.');
    return embed;
  }

  const active = accounts.filter(a => a.status === 'ACTIVE');
  const banned = accounts.filter(a => a.status === 'BANNED');
  const pending = accounts.filter(a => !a.status || a.status === 'PENDING');

  embed.addFields({ name: `🟢 Active (${active.length})`, value: active.length ? active.map(a => `@${a.username}`).join('\n') : 'None', inline: true });
  embed.addFields({ name: `🔴 Banned (${banned.length})`, value: banned.length ? banned.map(a => `@${a.username}`).join('\n') : 'None', inline: true });
  embed.addFields({ name: `🟡 Pending (${pending.length})`, value: pending.length ? pending.map(a => `@${a.username}`).join('\n') : 'None', inline: true });

  const alertCh = monitor.getAlertChannel();
  embed.addFields({ name: '📢 Alert Channel', value: alertCh ? `<#${alertCh}>` : 'Not set — use `/setchannel`', inline: false });

  return embed;
}

function buildHelpEmbed() {
  return new EmbedBuilder()
    .setTitle('📖 Instagram Monitor Bot — Commands')
    .setColor(0x5865f2)
    .setDescription('Monitor up to **10 Instagram accounts** for ban/unban status changes.')
    .addFields(
      { name: '`/add <username> [label]`', value: 'Add an account to monitor' },
      { name: '`/remove <username>`', value: 'Remove an account from monitoring' },
      { name: '`/check <username>`', value: 'Force an immediate check on one account' },
      { name: '`/status`', value: 'View the full monitoring dashboard' },
      { name: '`/list`', value: 'List all monitored accounts' },
      { name: '`/interval <minutes>`', value: 'Set how often accounts are checked (1–60 min)' },
      { name: '`/setchannel`', value: 'Set alert channel for status change notifications' },
      { name: '`/clear`', value: 'Remove all monitored accounts' },
      { name: '`/help`', value: 'Show this help message' },
    )
    .setFooter({ text: 'Instagram Monitor Bot • Powered by RapidAPI' });
}

function successEmbed(title, desc) {
  return new EmbedBuilder().setTitle(title).setDescription(desc).setColor(0x00e676).setTimestamp();
}

function errorEmbed(title, desc) {
  return new EmbedBuilder().setTitle(title).setDescription(desc).setColor(0xff1744).setTimestamp();
}

function infoEmbed(title, desc) {
  return new EmbedBuilder().setTitle(title).setDescription(desc).setColor(0x5865f2).setTimestamp();
}

// ─── Login ──────────────────────────────────────────────────────────────────
client.login(process.env.DISCORD_TOKEN).catch(err => {
  console.error('❌ Failed to login:', err.message);
  process.exit(1);
});
