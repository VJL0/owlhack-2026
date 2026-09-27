import { ElevenLabsClient, type ElevenLabs } from "@elevenlabs/elevenlabs-js";
const wsUrl = process.env.SPEECH_PUBLIC_WS_URL;
if (!wsUrl?.startsWith("wss://")) throw new Error("Set SPEECH_PUBLIC_WS_URL to the public Vultr wss://…/voice-engine endpoint.");
const client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });
const id = process.env.ELEVENLABS_SPEECH_ENGINE_ID;
const config: ElevenLabs.CreateSpeechEngineRequest = {
  name: "Reef Atlas Speech Engine",
  speechEngine: { wsUrl },
  // Preserve the existing engine's dashboard voice unless an override is explicit.
  tts: id && !process.env.ELEVENLABS_VOICE_ID ? undefined
    : { voiceId: process.env.ELEVENLABS_VOICE_ID ?? "JBFqnCBsd6RMkjVDRZzb", modelId: "eleven_flash_v2_5" },
  overrides: { firstMessage: true },
  conversation: { clientEvents: ["audio", "interruption", "user_transcript", "agent_response", "agent_response_correction"] },
};
const engine = id ? await client.speechEngine.update(id, config) : await client.speechEngine.create(config);
console.log(`ELEVENLABS_SPEECH_ENGINE_ID=${engine.engineId}`);
