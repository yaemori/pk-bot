const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const client = new Client({ 
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent] 
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID;
const SUBMISSIONS_CHANNEL_ID = process.env.SUBMISSIONS_CHANNEL_ID;
const SUBMIT_CHANNEL_ID = process.env.SUBMIT_CHANNEL_ID;


// Helper function to format time to 2 decimal places
function formatTime(timeStr) {
  const num = parseFloat(timeStr);
  if (isNaN(num)) return null;
  return num.toFixed(2);
}

// Helper function to normalize map code (add @ if missing)
function normalizeMapCode(mapCode) {
  const trimmed = mapCode.trim();
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

// Helper function to capitalize username (Name#0000 format)
function capitalizeUsername(username) {
  const [name, tag] = username.split('#');
  if (!name || !tag) return username;
  
  // Capitalize first letter of name, keep rest as lowercase
  const capitalizedName = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  return `${capitalizedName}#${tag}`;
}

client.on('ready', () => {
  console.log(`✅ Bot logged in as ${client.user.tag}`);
});

// Handle slash commands
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // DELETE COMMAND
  if (interaction.commandName === 'delete') {
    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (!member.roles.cache.has(ADMIN_ROLE_ID)) {
      return interaction.reply({ 
        content: '❌ Only admins can delete entries.', 
        ephemeral: true 
      });
    }

    const mapInput = interaction.options.getString('map');
    const rank = interaction.options.getInteger('rank');

    await interaction.deferReply({ ephemeral: true });

    try {
      // Normalize map code (add @ if not present)
      const mapCode = normalizeMapCode(mapInput);

      // Find the map by exact map_id match
      const { data: map, error: mapError } = await supabase
        .from('maps')
        .select('id, map_id, category, author')
        .eq('map_id', mapCode)
        .single();

      if (mapError || !map) {
        return interaction.editReply(`❌ Map not found! Make sure to use the exact map code.\nExample: \`${mapCode}\``);
      }

      // Get all entries for this map
      const { data: entries, error: entriesError } = await supabase
        .from('entries')
        .select('*')
        .eq('map_id', map.id);

      if (entriesError) throw entriesError;

      if (!entries || entries.length === 0) {
        return interaction.editReply(`❌ No entries found for map \`${map.map_id}\``);
      }

      // Sort entries by time (convert to number for proper sorting)
      const sortedEntries = entries.sort((a, b) => parseFloat(a.time) - parseFloat(b.time));

      // Check if rank exists
      if (rank < 1 || rank > sortedEntries.length) {
        return interaction.editReply(
          `❌ Invalid rank! Map \`${map.map_id}\` has ${sortedEntries.length} entries (ranks 1-${sortedEntries.length}).`
        );
      }

      // Get the entry at the specified rank (rank-1 because array is 0-indexed)
      const entryToDelete = sortedEntries[rank - 1];

      // Delete the entry
      const { error: deleteError } = await supabase
        .from('entries')
        .delete()
        .eq('id', entryToDelete.id);

      if (deleteError) throw deleteError;

      const embed = new EmbedBuilder()
        .setColor('#ef4444')
        .setTitle('🗑️ Entry Deleted Successfully')
        .addFields(
          { name: '🗺️ Map Code', value: map.map_id, inline: true },
          { name: '📂 Category', value: map.category, inline: true },
          { name: '📊 Rank Deleted', value: `#${rank}`, inline: true },
          { name: '👤 Player', value: entryToDelete.player_name, inline: true },
          { name: '⏱️ Time', value: entryToDelete.time + 's', inline: true },
          { name: '🔢 Entry ID', value: entryToDelete.id.toString(), inline: true }
        )
        .setFooter({ text: `Deleted by ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      console.log(`✅ Deleted rank ${rank} from ${map.map_id}: ${entryToDelete.player_name} (${entryToDelete.time}s)`);

    } catch (err) {
      console.error('Delete error:', err);
      interaction.editReply('❌ Error deleting entry. Please try again.');
    }
  }

  // SUBMIT COMMAND
  if (interaction.commandName === 'submit') {
    // Check if command is used in the correct channel
    if (interaction.channelId !== SUBMIT_CHANNEL_ID) {
      return interaction.reply({ 
        content: `❌ This command can only be used in <#${SUBMIT_CHANNEL_ID}>`, 
        ephemeral: true 
      });
    }

    const usernameInput = interaction.options.getString('username');
    const timeInput = interaction.options.getString('time');
    const proof = interaction.options.getString('proof');
    const mapInput = interaction.options.getString('map');

    const usernameRegex = /^.+#\d{4}$/;
    if (!usernameRegex.test(usernameInput)) {
      return interaction.reply({ 
        content: '❌ Username must be in format: Name#0000', 
        ephemeral: true 
      });
    }

    // Capitalize username
    const username = capitalizeUsername(usernameInput);

    // Format time to 2 decimal places
    const time = formatTime(timeInput);
    if (!time) {
      return interaction.reply({ 
        content: '❌ Time must be a valid number (e.g., 45.23)', 
        ephemeral: true 
      });
    }

    try {
      new URL(proof);
    } catch {
      return interaction.reply({ 
        content: '❌ Proof must be a valid URL', 
        ephemeral: true 
      });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      // Normalize map code
      const mapCode = normalizeMapCode(mapInput);

      // Find map by exact match
      const { data: map, error: mapError } = await supabase
        .from('maps')
        .select('id, map_id, category, author')
        .eq('map_id', mapCode)
        .single();

      if (mapError || !map) {
        return interaction.editReply(`❌ Map not found! Make sure to use the exact map code.\nExample: \`@968049\``);
      }

      const embed = new EmbedBuilder()
        .setColor('#60a5fa')
        .setTitle(`📊 New Score Submission`)
        .addFields(
          { name: '🗺️ Map Code', value: map.map_id, inline: true },
          { name: '📂 Category', value: map.category, inline: true },
          { name: '✍️ Author', value: map.author, inline: true },
          { name: '👤 Player', value: username, inline: true },
          { name: '⏱️ Time', value: time + 's', inline: true },
          { name: '📷 Proof', value: `[View Proof](${proof})`, inline: false }
        )
        .setTimestamp();

      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`approve_${map.id}_${username}_${time}`)
            .setLabel('✅ Approve')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`reject_discord`)
            .setLabel('❌ Reject')
            .setStyle(ButtonStyle.Danger)
        );

      const channel = client.channels.cache.get(SUBMISSIONS_CHANNEL_ID);
      if (channel) {
        await channel.send({ embeds: [embed], components: [row] });
      }

      interaction.editReply('✅ Your score has been sent for review!');
    } catch (err) {
      console.error(err);
      interaction.editReply('❌ Error submitting score. Please try again.');
    }
  }
});

// Listen for webhook messages and add buttons if they don't have any
client.on('messageCreate', async (message) => {
  if (!message.webhookId) return;
  if (message.channelId !== SUBMISSIONS_CHANNEL_ID) return;
  if (message.components.length > 0) return; // Already has buttons

  try {
    const embed = message.embeds[0];
    if (!embed || !embed.title.includes('Submission')) return;

    const mapField = embed.fields.find(f => f.name === '🗺️ Map' || f.name === '🗺️ Map Code');
    const playerField = embed.fields.find(f => f.name === '👤 Player');
    const timeField = embed.fields.find(f => f.name === '⏱️ Time');

    if (!mapField || !playerField || !timeField) return;

    const mapCode = normalizeMapCode(mapField.value);
    const playerNameInput = playerField.value;
    const playerName = capitalizeUsername(playerNameInput); // Capitalize webhook usernames too
    const timeStr = timeField.value.replace('s', '');
    const time = formatTime(timeStr);

    if (!time) return;

    const { data: mapData } = await supabase
      .from('maps')
      .select('id')
      .eq('map_id', mapCode)
      .single();

    if (!mapData) return;

    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`approve_${mapData.id}_${playerName}_${time}`)
          .setLabel('✅ Approve')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`reject_webhook`)
          .setLabel('❌ Reject')
          .setStyle(ButtonStyle.Danger)
      );

    await message.edit({ components: [row] });
    console.log(`✅ Added buttons to webhook submission from ${playerName}`);
  } catch (err) {
    console.error('Error adding buttons to webhook:', err);
  }
});

// Handle button clicks
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  const [action, ...params] = interaction.customId.split('_');

  if (action !== 'approve' && action !== 'reject') return;

  const member = await interaction.guild.members.fetch(interaction.user.id);
  if (!member.roles.cache.has(ADMIN_ROLE_ID)) {
    return interaction.reply({ content: '❌ Only admins can approve/reject.', ephemeral: true });
  }

  await interaction.deferUpdate();

  try {
    if (action === 'approve') {
      const paramsStr = params.join('_');
      const lastUnderscoreIndex = paramsStr.lastIndexOf('_');
      const time = paramsStr.substring(lastUnderscoreIndex + 1);
      const mapIdAndUsername = paramsStr.substring(0, lastUnderscoreIndex);
      const firstUnderscoreIndex = mapIdAndUsername.indexOf('_');
      const mapId = mapIdAndUsername.substring(0, firstUnderscoreIndex);
      const username = mapIdAndUsername.substring(firstUnderscoreIndex + 1);

      const { error: insertError } = await supabase
        .from('entries')
        .insert([
          {
            map_id: parseInt(mapId),
            player_name: username,
            time: time,
            rank: 1
          }
        ]);

      if (insertError) throw insertError;

      const embed = interaction.message.embeds[0];
      const updatedEmbed = EmbedBuilder.from(embed)
        .setColor('#22c55e')
        .setTitle(`✅ APPROVED`);

      await interaction.message.edit({ embeds: [updatedEmbed], components: [] });
      
      await interaction.followUp({ 
        content: `✅ Score approved and added to leaderboard!\n**Player:** ${username}\n**Time:** ${time}s`,
        ephemeral: true 
      });
    } else if (action === 'reject') {
      const embed = interaction.message.embeds[0];
      const updatedEmbed = EmbedBuilder.from(embed)
        .setColor('#ef4444')
        .setTitle(`❌ REJECTED`);

      await interaction.message.edit({ embeds: [updatedEmbed], components: [] });

      await interaction.followUp({ 
        content: '❌ Score rejected.',
        ephemeral: true 
      });
    }
  } catch (err) {
    console.error(err);
    interaction.followUp({ 
      content: '❌ Error processing approval.',
      ephemeral: true 
    });
  }
});

// Register slash commands
client.on('ready', async () => {
  try {
    const guild = client.guilds.cache.first();
    if (!guild) return;

    // Submit command
    await guild.commands.create({
      name: 'submit',
      description: 'Submit your score for a map',
      options: [
        {
          name: 'username',
          description: 'Your username (format: Name#0000)',
          type: 3,
          required: true
        },
        {
          name: 'map',
          description: 'Map code (with or without @, e.g., @968049 or 968049)',
          type: 3,
          required: true
        },
        {
          name: 'time',
          description: 'Your completion time (e.g., 45.23)',
          type: 3,
          required: true
        },
        {
          name: 'proof',
          description: 'Link to proof (screenshot/video)',
          type: 3,
          required: true
        }
      ]
    });

    // Delete command (Admin only)
    await guild.commands.create({
      name: 'delete',
      description: '[ADMIN] Delete an entry from the leaderboard',
      options: [
        {
          name: 'map',
          description: 'Map code (with or without @, e.g., @968049 or 968049)',
          type: 3,
          required: true
        },
        {
          name: 'rank',
          description: 'Rank position to delete (1 = first place, 2 = second, etc.)',
          type: 4, // INTEGER type
          required: true
        }
      ]
    });

    console.log('✅ Slash commands registered!');
  } catch (err) {
    console.error('Error:', err);
  }
});

client.login(process.env.DISCORD_TOKEN);