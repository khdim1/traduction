import React, { useState, useRef, useEffect } from 'react';

const App: React.FC = () => {
  const [isTranslating, setIsTranslating] = useState(false);
  const [sourceLang, setSourceLang] = useState('fr');
  const [targetLang, setTargetLang] = useState('en');
  const [statusMessage, setStatusMessage] = useState('Prêt');
  const [isWsConnected, setIsWsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const speechQueue = useRef<string[]>([]);
  const isSpeaking = useRef(false);

  const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:8000/ws/translate';

  const speak = (text: string, lang: string) => {
    if (!window.speechSynthesis) return;
    speechQueue.current.push(text);
    if (!isSpeaking.current) {
      processQueue(lang);
    }
  };

  const processQueue = (lang: string) => {
    if (speechQueue.current.length === 0) {
      isSpeaking.current = false;
      return;
    }
    isSpeaking.current = true;
    const text = speechQueue.current.shift()!;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang === 'en' ? 'en-US' : 'fr-FR';
    utterance.rate = 0.9;
    utterance.onend = () => processQueue(lang);
    utterance.onerror = () => processQueue(lang);
    window.speechSynthesis.speak(utterance);
  };

  useEffect(() => {
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    ws.onopen = () => {
      setIsWsConnected(true);
      setStatusMessage('Connecté');
      ws.send(JSON.stringify({ type: 'config', source_lang: sourceLang, target_lang: targetLang }));
    };
    ws.onerror = () => {
      setIsWsConnected(false);
      setStatusMessage('Erreur WebSocket');
    };
    ws.onclose = () => {
      setIsWsConnected(false);
      setStatusMessage('Déconnecté');
    };
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'translated_text') {
        speak(data.text, targetLang);
      }
    };
    return () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.close();
      stopTranslation();
    };
  }, [sourceLang, targetLang, wsUrl]);

  const startTranslation = async () => {
    if (!isWsConnected) {
      setStatusMessage('Connexion WebSocket en cours...');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      sourceNodeRef.current = source;
      // Buffer 2048 échantillons = 128 ms
      const processor = audioContext.createScriptProcessor(2048, 1, 1);
      processorRef.current = processor;
      // @ts-ignore
      processor.onaudioprocess = (event) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          const inputData = event.inputBuffer.getChannelData(0);
          const pcm = new Int16Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) {
            const s = Math.max(-1, Math.min(1, inputData[i]));
            pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }
          const audioBase64 = btoa(String.fromCharCode(...new Uint8Array(pcm.buffer)));
          wsRef.current.send(JSON.stringify({ type: 'audio', audio: audioBase64 }));
        }
      };
      source.connect(processor);
      processor.connect(audioContext.destination);
      await audioContext.resume();
      setIsTranslating(true);
      setStatusMessage('Écoute en continu...');
    } catch (err) {
      setStatusMessage('Erreur microphone');
    }
  };

  const stopTranslation = () => {
    if (processorRef.current) processorRef.current.disconnect();
    if (sourceNodeRef.current) sourceNodeRef.current.disconnect();
    if (audioContextRef.current) audioContextRef.current.close();
    if (mediaStreamRef.current) mediaStreamRef.current.getTracks().forEach(t => t.stop());
    setIsTranslating(false);
    setStatusMessage('Arrêté');
    speechQueue.current = [];
    isSpeaking.current = false;
    window.speechSynthesis.cancel();
  };

  const swapLanguages = () => {
    if (!isTranslating) {
      setSourceLang(targetLang);
      setTargetLang(sourceLang);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0B1120 0%, #19212E 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div style={{ maxWidth: '750px', width: '100%', background: 'rgba(18,25,40,0.75)', backdropFilter: 'blur(16px)', borderRadius: '2rem', border: '1px solid rgba(255,255,255,0.1)', padding: '2rem' }}>
        <h1 style={{ textAlign: 'center', color: 'white' }}>Traducteur Temps Réel</h1>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', margin: '1rem 0' }}>
          <select value={sourceLang} onChange={(e) => setSourceLang(e.target.value)} disabled={isTranslating}>
            <option value="fr">Français</option>
            <option value="en">English</option>
          </select>
          <button onClick={swapLanguages} disabled={isTranslating}>⇄</button>
          <select value={targetLang} onChange={(e) => setTargetLang(e.target.value)} disabled={isTranslating}>
            <option value="en">English</option>
            <option value="fr">Français</option>
          </select>
        </div>
        <div style={{ background: 'rgba(0,0,0,0.35)', borderRadius: '1rem', padding: '1rem', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <div style={{ width: '10px', height: '10px', borderRadius: '10px', background: isTranslating ? '#10B981' : (isWsConnected ? '#3B82F6' : '#EF4444') }} />
            <span>{statusMessage}</span>
          </div>
        </div>
        <button onClick={isTranslating ? stopTranslation : startTranslation} disabled={!isWsConnected && !isTranslating} style={{ width: '100%', padding: '1rem', borderRadius: '2rem', fontWeight: 'bold', background: isTranslating ? '#EF4444' : '#3B82F6', color: 'white', cursor: (isTranslating || isWsConnected) ? 'pointer' : 'not-allowed' }}>
          {isTranslating ? 'Arrêter la traduction' : 'Commencer la traduction'}
        </button>
        <p style={{ fontSize: '0.7rem', textAlign: 'center', marginTop: '1rem', color: '#6B7280' }}>
          🔒 Audio local • Deepgram (transcription) + Mistral (traduction) • Synthèse vocale navigateur
        </p>
      </div>
    </div>
  );
};

export default App;