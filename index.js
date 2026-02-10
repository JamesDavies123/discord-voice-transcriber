import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import OpenAI from "openai";
import fetch from "node-fetch";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";

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

function guessExt(attachment) {
  const name = (attachment?.name || "").toLowerCase();
  if (name.endsWith(".mp3")) return "mp3";
  if (name.endsWith(".wav")) return "wav";
  if (name.endsWith(".m4a")) return "m4a";
  if (name.endsWith(".webm")) return "webm";
  return "ogg";
}

client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;

  const audio = getAudio(msg);
  if (!audio) return;

  const tmpId = crypto.randomBytes(8).toString("hex");
  const ext = guessExt(audio);
  const tmpPath = path.join(os.tmpdir(), `discord-voice-${tmpId}.${ext}`);

  try {
    // Shows it's been detected
    await msg.react("📝");

    // Download attachment from Discord
    const res = await fetch(audio.url);
    if (!res.ok) throw new Error(`Failed to download audio: ${res.status} ${res.statusText}`);

    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(tmpPath, buffer);

    // Send audio file to OpenAI transcription
    const result = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmpPath),
      model: "gpt-4o-mini-transcribe",
    });

    const text = (result?.text || "").trim();
    await msg.reply(`📝 **Transcript:**\n${text || "[No speech detected]"}`);
  } catch (e) {
    console.error("Transcription error:", e);
    try {
      await msg.reply("Could not transcribe that voice note.");
    } catch {}
  } finally {
    // Clean up temp file
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {}
  }
});

client.login(process.env.DISCORD_TOKEN);
