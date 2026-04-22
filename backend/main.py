import asyncio
import base64
import json
import os
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import httpx
import edge_tts
import vosk

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Dictionary to store loaded models
models = {}

# Paths to your model folders
model_paths = {
    "fr": "models/fr",  # e.g., vosk-model-small-fr-0.22
    "en": "models/en",  # e.g., vosk-model-small-en-us-0.15
    "es": "models/es",  # e.g., vosk-model-small-es-0.42
    "de": "models/de",  # e.g., vosk-model-small-de-0.15
    "it": "models/it",  # e.g., vosk-model-small-it-0.22
}

for lang, path in model_paths.items():
    if os.path.exists(path):
        models[lang] = vosk.Model(path)
        print(f"✅ Model for {lang} loaded from {path}")
    else:
        print(f"⚠️ Model for {lang} not found at {path}")

class RealtimeTranslator:
    def __init__(self, websocket: WebSocket, source_lang: str, target_lang: str):
        self.websocket = websocket
        self.source_lang = source_lang
        self.target_lang = target_lang
        self.audio_buffer = b""
        self.rec = vosk.KaldiRecognizer(models[source_lang], 16000)
        self.rec.SetWords(False)

    async def translate_text(self, text: str) -> str:
        async with httpx.AsyncClient() as client:
            url = "https://api.mymemory.translated.net/get"
            params = {
                "q": text,
                "langpair": f"{self.source_lang}|{self.target_lang}"
            }
            try:
                resp = await client.get(url, params=params, timeout=5.0)
                data = resp.json()
                return data["responseData"]["translatedText"]
            except Exception as e:
                print(f"Error from MyMemory: {e}")
                return text

    async def synthesize(self, text: str):
        voices = {
            ("en", "EN"): "en-US-JennyNeural",
            ("fr", "FR"): "fr-FR-DeniseNeural",
            ("es", "ES"): "es-ES-ElviraNeural",
            ("de", "DE"): "de-DE-KatjaNeural",
            ("it", "IT"): "it-IT-ElsaNeural"
        }
        voice_key = (self.target_lang, self.target_lang.upper())
        voice = voices.get(voice_key, "en-US-JennyNeural")

        communicate = edge_tts.Communicate(text, voice=voice)
        audio_content = b""
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_content += chunk["data"]

        audio_b64 = base64.b64encode(audio_content).decode('utf-8')
        await self.websocket.send_text(json.dumps({
            "type": "translated_audio",
            "audio": audio_b64
        }))
        print("✅ Audio sent to frontend")

    async def feed_audio(self, audio_bytes: bytes):
        self.audio_buffer += audio_bytes
        while len(self.audio_buffer) >= 16000:
            chunk = self.audio_buffer[:16000]
            self.audio_buffer = self.audio_buffer[16000:]
            if self.rec.AcceptWaveform(chunk):
                result = json.loads(self.rec.Result())
                text = result.get("text", "")
                if text:
                    print(f"📝 [{self.source_lang}] {text}")
                    translated = await self.translate_text(text)
                    print(f"🌐 [{self.target_lang}] {translated}")
                    await self.synthesize(translated)
            else:
                partial = json.loads(self.rec.PartialResult())
                if partial.get("partial"):
                    # Optional: send partial results to frontend for live display
                    pass

    async def close(self):
        pass

@app.websocket("/ws/translate")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    translator = None
    try:
        while True:
            message = await websocket.receive_text()
            data = json.loads(message)

            if data.get("type") == "config":
                source_lang = data.get("source_lang", "fr")
                target_lang = data.get("target_lang", "en")
                if source_lang not in models or target_lang not in models:
                    await websocket.close(code=1008, reason="Language not supported")
                    return
                translator = RealtimeTranslator(websocket, source_lang, target_lang)
                print(f"✅ Translator ready: {source_lang} -> {target_lang}")
            elif data.get("type") == "audio" and translator:
                audio_b64 = data.get("audio")
                audio_bytes = base64.b64decode(audio_b64)
                await translator.feed_audio(audio_bytes)

    except WebSocketDisconnect:
        if translator:
            await translator.close()