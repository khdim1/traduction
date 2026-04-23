import asyncio
import base64
import json
import os
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import httpx
from deepgram import DeepgramClient, LiveTranscriptionEvents, LiveOptions

load_dotenv()

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DEEPGRAM_API_KEY = os.getenv("DEEPGRAM_API_KEY")
MISTRAL_API_KEY = os.getenv("MISTRAL_API_KEY")

if not DEEPGRAM_API_KEY or not MISTRAL_API_KEY:
    raise Exception("Missing API keys")

deepgram_client = DeepgramClient(api_key=DEEPGRAM_API_KEY)

class RealtimeTranslator:
    def __init__(self, websocket: WebSocket, source_lang: str, target_lang: str):
        self.client_ws = websocket
        self.source_lang = source_lang
        self.target_lang = target_lang
        self.dg_connection = None
        self.loop = asyncio.get_running_loop()
        self.translation_queue = asyncio.Queue()
        self.processing_task = None
        self.is_connected = False

    async def connect_deepgram(self):
        self.dg_connection = deepgram_client.listen.live.v("1")
        
        def on_message(_, result, **kwargs):
            asyncio.run_coroutine_threadsafe(self.handle_transcription(result), self.loop)
        
        def on_error(_, error, **kwargs):
            print(f"Deepgram error: {error}")
            self.is_connected = False
        
        def on_close(_, **kwargs):
            print("Deepgram connection closed")
            self.is_connected = False
        
        self.dg_connection.on(LiveTranscriptionEvents.Transcript, on_message)
        self.dg_connection.on(LiveTranscriptionEvents.Error, on_error)
        self.dg_connection.on(LiveTranscriptionEvents.Close, on_close)
        
        options = LiveOptions(
            model="nova-2",
            language=self.source_lang,
            punctuate=True,
            interim_results=True,          # Flux continu
            encoding="linear16",
            sample_rate=16000,
            channels=1,
            endpointing=300,               # 300ms de silence pour finaliser
        )
        self.dg_connection.start(options)
        self.is_connected = True
        print(f"✅ Deepgram connecté ({self.source_lang})")

    async def handle_transcription(self, result):
        text = result.channel.alternatives[0].transcript
        if text:
            is_final = getattr(result, 'is_final', False)
            await self.translation_queue.put((text.strip(), is_final))

    async def feed_audio(self, audio_bytes: bytes):
        if self.dg_connection is None or not self.is_connected:
            await self.connect_deepgram()
        try:
            self.dg_connection.send(audio_bytes)
        except Exception as e:
            print(f"Erreur envoi: {e}")
            self.is_connected = False

    async def translate_text(self, text: str) -> str:
        if not text.strip():
            return ""
        async with httpx.AsyncClient(timeout=1.5) as client:
            headers = {
                "Authorization": f"Bearer {MISTRAL_API_KEY}",
                "Content-Type": "application/json"
            }
            payload = {
                "model": "open-mistral-nemo",
                "messages": [{"role": "user", "content": f"Translate the following {self.source_lang} text to {self.target_lang}. Output ONLY the translation, no extra text, no explanations.\n\n{text}"}],
                "temperature": 0.0
            }
            try:
                resp = await client.post("https://api.mistral.ai/v1/chat/completions", headers=headers, json=payload)
                if resp.status_code == 200:
                    return resp.json()["choices"][0]["message"]["content"].strip()
                else:
                    return text
            except Exception:
                return text

    async def process_translations(self):
        while True:
            text, is_final = await self.translation_queue.get()
            if len(text.split()) < 1:
                continue
            # Ne traduire que les segments finals (fin de phrase ou pause)
            if is_final:
                print(f"📝 Transcription: {text}")
                translated = await self.translate_text(text)
                print(f"🌐 Traduction: {translated}")
                await self.client_ws.send_text(json.dumps({
                    "type": "translated_text",
                    "text": translated
                }))

    async def start_processing(self):
        self.processing_task = asyncio.create_task(self.process_translations())

    async def close(self):
        if self.processing_task:
            self.processing_task.cancel()
        if self.dg_connection:
            self.dg_connection.finish()

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
                translator = RealtimeTranslator(websocket, src, tgt)
                await translator.connect_deepgram()
                await translator.start_processing()
                print(f"✅ Traducteur prêt: {src} -> {tgt}")
            elif data.get("type") == "audio" and translator:
                audio_bytes = base64.b64decode(data.get("audio"))
                await translator.feed_audio(audio_bytes)
    except WebSocketDisconnect:
        if translator:
            await translator.close()