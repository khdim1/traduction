import asyncio
import base64
import json
import os
import time
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import vosk
import torch
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Modèle Vosk pour la reconnaissance vocale française
MODEL_PATH = "models/fr"
if not os.path.exists(MODEL_PATH):
    raise Exception("Téléchargez le modèle Vosk français dans backend_wolof/models/fr")
model_vosk = vosk.Model(MODEL_PATH)

# Modèle de traduction allégé français -> wolof
print("Chargement du modèle de traduction wolof (allégé)...")
model_name = "bilalfaye/nllb-200-distilled-600M-wo-fr-en"
tokenizer = AutoTokenizer.from_pretrained(model_name)
model = AutoModelForSeq2SeqLM.from_pretrained(model_name)
device = "cuda" if torch.cuda.is_available() else "cpu"
model.to(device)
print(f"✅ Modèle wolof chargé sur {device}")

def translate_to_wolof(text: str) -> str:
    """Traduit du français vers le wolof en utilisant le modèle NLLB allégé."""
    inputs = tokenizer(text, return_tensors="pt", truncation=True, max_length=512).to(device)
    with torch.no_grad():
        outputs = model.generate(
            **inputs,
            forced_bos_token_id=tokenizer.convert_tokens_to_ids("wol_Latn"),  # Force la sortie en wolof
            max_length=128
        )
    return tokenizer.decode(outputs[0], skip_special_tokens=True)

class WolofTranslator:
    def __init__(self, websocket: WebSocket):
        self.websocket = websocket
        self.rec = vosk.KaldiRecognizer(model_vosk, 16000)
        self.rec.SetWords(False)
        self.audio_buffer = b""
        self.sentence_buffer = ""
        self.last_speech_time = time.time()
        self.silence_timeout = 0.8

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
                    if text.endswith(('.', '!', '?')):
                        await self.finalize()
            else:
                # Détection de silence prolongé
                if self.sentence_buffer and (time.time() - self.last_speech_time > self.silence_timeout):
                    await self.finalize()

    async def finalize(self):
        if not self.sentence_buffer.strip():
            return
        text = self.sentence_buffer.strip()
        if len(text.split()) < 2:
            self.sentence_buffer = ""
            return
        print(f"📝 [fr] {text}")
        translated = translate_to_wolof(text)
        print(f"🌐 [wo] {translated}")
        await self.websocket.send_text(json.dumps({
            "type": "translated_text",
            "text": translated
        }))
        self.sentence_buffer = ""

    async def close(self):
        if self.sentence_buffer:
            await self.finalize()

@app.websocket("/ws/translate-wolof")
async def websocket_wolof(websocket: WebSocket):
    await websocket.accept()
    translator = None
    try:
        while True:
            msg = await websocket.receive_text()
            data = json.loads(msg)
            if data.get("type") == "config":
                translator = WolofTranslator(websocket)
                print("✅ Traducteur wolof prêt")
            elif data.get("type") == "audio" and translator:
                audio_bytes = base64.b64decode(data.get("audio"))
                await translator.feed_audio(audio_bytes)
    except WebSocketDisconnect:
        if translator:
            await translator.close()