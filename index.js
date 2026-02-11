import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import OpenAI from "openai";
import fetch from "node-fetch";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { execFile } from "child_process";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function getAudio(message) {
  const files = [...message.attachments.values()];
  return files.find(
    (f) =>
      (f.contentType || "").startsWith("audio/") ||
      (f.name || "").match(/\.(ogg|mp3|wav|m4a|webm)$/i)
  );
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve({ stdout, stderr });
    });
  });
}

client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;

  const audio = getAudio(msg);
  if (!audio) return;

  const id = crypto.randomBytes(8).toString("hex");
  const inputPath = path.join(os.tmpdir(), `discord-voice-${id}.input`);
  const chunkPattern = path.join(os.tmpdir(), `discord-voice-${id}-%03d.wav`);

  try {
    await msg.react("📝");

    // Download from Discord
    const res = await fetch(audio.url);
    if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(inputPath, buffer);

    // Convert + split into 60s WAV chunks (more reliable for long webm/opus)
    // - 16kHz mono PCM is a safe transcription format.
    await run("ffmpeg", [
      "-y",
      "-i",
      inputPath,
      "-f",
      "segment",
      "-segment_time",
      "60",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
      chunkPattern,
    ]);

    // Collect chunk files
    const dirFiles = fs.readdirSync(os.tmpdir());
    const chunks = dirFiles
      .filter((f) => f.startsWith(`discord-voice-${id}-`) && f.endsWith(".wav"))
      .sort()
      .map((f) => path.join(os.tmpdir(), f));

    if (!chunks.length) throw new Error("No audio chunks produced.");

    // Transcribe each chunk and stitch together
    const parts = [];
    for (const wavPath of chunks) {
      const result = await openai.audio.transcriptions.create({
        file: fs.createReadStream(wavPath),
        model: "gpt-4o-mini-transcribe",
      });
      const text = (result?.text || "").trim();
      if (text) parts.push(text);
    }

    const finalText = parts.join("\n");
    await msg.reply(`📝 **Transcript:**\n${finalText || "[No speech detected]"}`);
  } catch (e) {
    console.error("Transcription error:", e);
    await msg.reply("Could not transcribe that voice note.");
  } finally {
    // Cleanup temp files
    try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); } catch {}
    try {
      const dirFiles = fs.readdirSync(os.tmpdir());
      for (const f of dirFiles) {
        if (f.startsWith(`discord-voice-${id}-`) && f.endsWith(".wav")) {
          try { fs.unlinkSync(path.join(os.tmpdir(), f)); } catch {}
        }
      }
    } catch {}
  }
});

client.login(process.env.DISCORD_TOKEN);
