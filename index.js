import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import OpenAI from "openai";
import fetch from "node-fetch";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function getAudio(message) {
  const files = [...message.attachments.values()];
  return files.find(
    (f) =>
      (f.contentType || "").startsWith("audio/") ||
      (f.name || "").match(/\.(ogg|mp3|wav|m4a|webm)$/i)
  );
}

client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;

  const audio = getAudio(msg);
  if (!audio) return;

  try {
    await msg.react("📝");

    const res = await fetch(audio.url);
    const buffer = Buffer.from(await res.arrayBuffer());

    const file = new File([buffer], audio.name || "audio.ogg");

    const result = await openai.audio.transcriptions.create({
      file,
      model: "gpt-4o-mini-transcribe",
    });

    await msg.reply(
      `📝 **Transcript:**\n${result.text}`
    );

  } catch (e) {
    console.error(e);
    await msg.reply("Could not transcribe that voice note.");
  }
});

client.login(process.env.DISCORD_TOKEN);

