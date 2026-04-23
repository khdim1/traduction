import asyncio
import base64
import json
import os
import time
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import httpx
import vosk

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173", "https://*.onrender.com"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MODEL_PATHS = {
    "fr": "models/fr",
    "en": "models/en",
}
models = {}

for lang, path in MODEL_PATHS.items():
    if os.path.exists(path):
        models[lang] = vosk.Model(path)
        print(f"✅ Modèle Vosk {lang} chargé")
    else:
        print(f"⚠️ Modèle {lang} manquant dans {path}")

translation_cache = {}
CACHE_TTL = 60

class Translator:
    def __init__(self, websocket: WebSocket, source_lang: str, target_lang: str):
        self.websocket = websocket
        self.source_lang = source_lang
        self.target_lang = target_lang
        self.audio_buffer = b""
        self.rec = vosk.KaldiRecognizer(models[source_lang], 16000)
        self.rec.SetWords(False)
        self.sentence_buffer = ""
        self.last_speech_time = 0
        self.silence_timeout = 0.8  # secondes

    async def translate_text(self, text: str) -> str:
        if not text.strip():
            return ""
        cache_key = f"{self.source_lang}|{self.target_lang}|{text}"
        if cache_key in translation_cache:
            entry = translation_cache[cache_key]
            if time.time() - entry['time'] < CACHE_TTL:
                return entry['text']

        async with httpx.AsyncClient(timeout=0.9) as client:
            url = "https://api.mymemory.translated.net/get"
            params = {"q": text, "langpair": f"{self.source_lang}|{self.target_lang}"}
            try:
                resp = await client.get(url, params=params)
                data = resp.json()
                translated = data["responseData"]["translatedText"]
                translated = translated.replace('&#39;', "'").split('/')[0].strip()
                translation_cache[cache_key] = {'text': translated, 'time': time.time()}
                return translated
            except Exception:
                return text

    async def feed_audio(self, audio_bytes: bytes):
        self.audio_buffer += audio_bytes
        while len(self.audio_buffer) >= 8000:
            chunk = self.audio_buffer[:8000]
            self.audio_buffer = self.audio_buffer[8000:]
            if self.rec.AcceptWaveform(chunk):
                result = json.loads(self.rec.Result())
                text = result.get("text", "")
                if text:
                    self.sentence_buffer += " " + text
                    self.last_speech_time = time.time()
            else:
                # Vérifier le silence prolongé
                if self.sentence_buffer and (time.time() - self.last_speech_time > self.silence_timeout):
                    await self.finalize_sentence()
        # Si le buffer est vide et qu'il y a une phrase en attente, finaliser (pour la toute fin)
        if not self.audio_buffer and self.sentence_buffer:
            await self.finalize_sentence()

    async def finalize_sentence(self):
        if not self.sentence_buffer.strip():
            return
        text = self.sentence_buffer.strip()
        # Ne pas traduire si trop court
        if len(text.split()) < 2:
            self.sentence_buffer = ""
            return
        print(f"📝 [{self.source_lang}] {text}")
        translated = await self.translate_text(text)
        print(f"🌐 [{self.target_lang}] {translated}")
        await self.websocket.send_text(json.dumps({
            "type": "translated_text",
            "text": translated
        }))
        self.sentence_buffer = ""

    async def close(self):
        pass

@app.websocket("/ws/translate")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    translator = None
    try:
        while True:
            msg = await websocket.receive_text()
            data = json.loads(msg)
            if data.get("type") == "config":
                src = data.get("source_lang", "fr")
                tgt = data.get("target_lang", "en")
                if src not in models or tgt not in models:
                    await websocket.close(code=1008, reason="Langue non supportée")
                    return
                translator = Translator(websocket, src, tgt)
                print(f"✅ Interprète phrase complète: {src} → {tgt}")
            elif data.get("type") == "audio" and translator:
                audio_bytes = base64.b64decode(data.get("audio"))
                await translator.feed_audio(audio_bytes)
    except WebSocketDisconnect:
        if translator:
            await translator.close()