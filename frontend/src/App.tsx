import React, { useState, useCallback, useEffect, useRef } from 'react';
import { PalabraClient, getLocalAudioTrack } from '@palabra-ai/translator';

type Language = 'fr' | 'en' | 'es' | 'pt' | 'it' | 'de' | 'ar' | 'wo';

const App: React.FC = () => {
  const [isTranslating, setIsTranslating] = useState(false);
  const [sourceLang, setSourceLang] = useState<Language>('fr');
  const [targetLang, setTargetLang] = useState<Language>('en');
  const [transcription, setTranscription] = useState('');
  const [translation, setTranslation] = useState('');
  const [status, setStatus] = useState('Prêt');
  const clientRef = useRef<PalabraClient | null>(null);
  const wolofWsRef = useRef<WebSocket | null>(null);
  const wolofStreamRef = useRef<MediaStream | null>(null);
  const wolofAudioCtxRef = useRef<AudioContext | null>(null);
  const wolofProcessorRef = useRef<ScriptProcessorNode | null>(null);

  const CLIENT_ID = "ffe1eaea40ffe09adbcf9ba4765c9e9b";
  const CLIENT_SECRET = "7e731b15e3d95c77593beb343553ad5f149cc56f9f106868909a06fa9b14ef75";

  // Synthèse vocale commune
  const speak = (text: string, lang: string) => {
    if (!window.speechSynthesis) return;
    const utterance = new SpeechSynthesisUtterance(text);
    switch (lang) {
      case 'fr':
        utterance.lang = 'fr-FR';
        break;
      case 'en':
        utterance.lang = 'en-US';
        break;
      case 'es':
        utterance.lang = 'es-ES';
        break;
      case 'pt':
        utterance.lang = 'pt-PT';
        break;
      case 'it':
        utterance.lang = 'it-IT';
        break;
      case 'de':
        utterance.lang = 'de-DE';
        break;
      case 'ar':
        utterance.lang = 'ar-EG';
        break;
      default:
        utterance.lang = 'fr-FR'; // fallback pour wolof (pas de voix wolof native)
    }
    utterance.rate = 0.9;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  };

  // Démarrage du backend wolof (socket dédié)
  const startWolofTranslation = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      wolofStreamRef.current = stream;
      const audioCtx = new AudioContext({ sampleRate: 16000 });
      wolofAudioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(2048, 1, 1);
      wolofProcessorRef.current = processor;
      processor.onaudioprocess = (event) => {
        if (wolofWsRef.current?.readyState === WebSocket.OPEN) {
          const input = event.inputBuffer.getChannelData(0);
          const pcm = new Int16Array(input.length);
          for (let i = 0; i < input.length; i++) {
            const s = Math.max(-1, Math.min(1, input[i]));
            pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }
          const b64 = btoa(String.fromCharCode(...new Uint8Array(pcm.buffer)));
          wolofWsRef.current.send(JSON.stringify({ type: 'audio', audio: b64 }));
        }
      };
      source.connect(processor);
      processor.connect(audioCtx.destination);
      await audioCtx.resume();
      setIsTranslating(true);
      setStatus('🎙️ Écoute (wolof)');
    } catch (err) {
      setStatus('❌ Micro non autorisé');
    }
  }, []);

  const stopWolofTranslation = useCallback(() => {
    if (wolofProcessorRef.current) wolofProcessorRef.current.disconnect();
    if (wolofAudioCtxRef.current) wolofAudioCtxRef.current.close();
    if (wolofStreamRef.current) wolofStreamRef.current.getTracks().forEach(t => t.stop());
    setIsTranslating(false);
    setStatus('Arrêté');
    setTranscription('');
    setTranslation('');
  }, []);

  // Connexion WebSocket wolof (cible = wo)
  useEffect(() => {
    if (targetLang !== 'wo') {
      if (wolofWsRef.current) {
        wolofWsRef.current.close();
        wolofWsRef.current = null;
      }
      return;
    }
    const ws = new WebSocket('ws://localhost:8001/ws/translate-wolof');
    wolofWsRef.current = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'config' }));
      setStatus('Connecté (wolof)');
    };
    ws.onerror = () => setStatus('Erreur WebSocket wolof');
    ws.onclose = () => setStatus('Déconnecté (wolof)');
    ws.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === 'translated_text') {
        setTranslation(data.text);
        speak(data.text, 'wo');
      }
    };
    return () => ws.close();
  }, [targetLang]);

  // Palabra start/stop
  const startPalabraTranslation = useCallback(async () => {
    if (!CLIENT_ID || !CLIENT_SECRET) {
      setStatus('Erreur : clés API manquantes');
      return;
    }
    try {
      setStatus('Connexion...');
      const client = new PalabraClient({
        auth: { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET },
        translateFrom: sourceLang,
        translateTo: targetLang,
        handleOriginalTrack: getLocalAudioTrack,
      } as any);
      (client as any).on('transcription', (data: any) => setTranscription(data.text));
      (client as any).on('translation', (data: any) => {
        setTranslation(data.text);
        speak(data.text, targetLang);
      });
      await client.startTranslation();
      await client.startPlayback();
      clientRef.current = client;
      setIsTranslating(true);
      setStatus('🎙️ En écoute');
    } catch (error) {
      console.error(error);
      setStatus('Erreur : clés ou micro invalide');
    }
  }, [sourceLang, targetLang]);

  const stopPalabraTranslation = useCallback(async () => {
    if (clientRef.current) {
      await clientRef.current.stopPlayback();
      await clientRef.current.stopTranslation();
      clientRef.current = null;
    }
    setIsTranslating(false);
    setStatus('Arrêté');
    setTranscription('');
    setTranslation('');
  }, []);

  // Dispatch général
  const startTranslation = useCallback(() => {
    if (targetLang === 'wo') startWolofTranslation();
    else startPalabraTranslation();
  }, [targetLang, startWolofTranslation, startPalabraTranslation]);

  const stopTranslation = useCallback(() => {
    if (targetLang === 'wo') stopWolofTranslation();
    else stopPalabraTranslation();
  }, [targetLang, stopWolofTranslation, stopPalabraTranslation]);

  const swap = () => {
    if (!isTranslating) {
      setSourceLang(targetLang);
      setTargetLang(sourceLang);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0f172a, #020617)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ background: 'rgba(15,25,45,0.75)', backdropFilter: 'blur(18px)', borderRadius: '2rem', padding: '2rem', maxWidth: '700px', width: '100%', border: '1px solid rgba(255,255,255,0.1)' }}>
        <h1 style={{ textAlign: 'center', fontSize: '2rem', background: 'linear-gradient(135deg, #fff, #a5b4fc)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Interprète IA</h1>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', margin: '1.5rem 0' }}>
          <select value={sourceLang} onChange={(e) => setSourceLang(e.target.value as Language)} disabled={isTranslating} style={{ background: '#1e293b', padding: '0.5rem 1rem', borderRadius: '2rem', color: 'white', border: 'none' }}>
            <option value="fr">Français 🇫🇷</option>
            <option value="en">English 🇬🇧</option>
            <option value="es">Español 🇪🇸</option>
            <option value="pt">Português 🇵🇹</option>
            <option value="it">Italiano 🇮🇹</option>
            <option value="de">Deutsch 🇩🇪</option>
            <option value="ar">العربية 🇸🇦</option>
            <option value="wo">Wolof 🇸🇳</option>
          </select>
          <button onClick={swap} disabled={isTranslating} style={{ background: '#3b82f6', border: 'none', borderRadius: '3rem', width: '48px', fontSize: '1.5rem', color: 'white', cursor: 'pointer' }}>⇄</button>
          <select value={targetLang} onChange={(e) => setTargetLang(e.target.value as Language)} disabled={isTranslating} style={{ background: '#1e293b', padding: '0.5rem 1rem', borderRadius: '2rem', color: 'white', border: 'none' }}>
            <option value="en">English 🇬🇧</option>
            <option value="fr">Français 🇫🇷</option>
            <option value="es">Español 🇪🇸</option>
            <option value="pt">Português 🇵🇹</option>
            <option value="it">Italiano 🇮🇹</option>
            <option value="de">Deutsch 🇩🇪</option>
            <option value="ar">العربية 🇸🇦</option>
            <option value="wo">Wolof 🇸🇳</option>
          </select>
        </div>
        <div style={{ textAlign: 'center' }}>
          <button onClick={isTranslating ? stopTranslation : startTranslation} style={{ background: isTranslating ? '#ef4444' : '#3b82f6', border: 'none', borderRadius: '3rem', padding: '0.8rem 2rem', fontSize: '1.2rem', fontWeight: 'bold', color: 'white', cursor: 'pointer' }}>
            {isTranslating ? '⏹️ Arrêter' : '🎤 Commencer la traduction'}
          </button>
        </div>
        <div style={{ marginTop: '1.5rem', background: 'rgba(0,0,0,0.4)', borderRadius: '1rem', padding: '1rem' }}>
          <div style={{ color: '#94a3b8' }}>Statut : {status}</div>
          <div style={{ marginTop: '0.5rem', color: '#cbd5e1' }}>📝 {transcription || '...'}</div>
          <div style={{ marginTop: '0.5rem', color: 'white', fontWeight: 'bold' }}>🔄 {translation || '✨ ...'}</div>
        </div>
        <div style={{ textAlign: 'center', fontSize: '0.7rem', marginTop: '1rem', color: '#475569' }}>
          🔒 Palabra.ai (WebRTC) • Traduction wolof locale • Synthèse vocale intégrée
        </div>
      </div>
    </div>
  );
};

export default App;