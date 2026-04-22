import React, { useState, useRef, useEffect } from 'react';

const App: React.FC = () => {
  const [isTranslating, setIsTranslating] = useState(false);
  const [sourceLang, setSourceLang] = useState('fr');
  const [targetLang, setTargetLang] = useState('en');
  const [statusMessage, setStatusMessage] = useState('Ready');
  const [isWsConnected, setIsWsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  const languageOptions = {
    fr: 'Français 🇫🇷',
    en: 'English 🇬🇧',
    es: 'Español 🇪🇸',
    de: 'Deutsch 🇩🇪',
    it: 'Italiano 🇮🇹',
  };

  useEffect(() => {
    const ws = new WebSocket('ws://localhost:8000/ws/translate');
    wsRef.current = ws;
    ws.onopen = () => {
      setIsWsConnected(true);
      setStatusMessage('Connected');
      ws.send(JSON.stringify({ type: 'config', source_lang: sourceLang, target_lang: targetLang }));
    };
    ws.onerror = () => {
      setIsWsConnected(false);
      setStatusMessage('Connection error');
    };
    ws.onclose = () => {
      setIsWsConnected(false);
      setStatusMessage('Disconnected');
    };
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'translated_audio') {
        try {
          const binary = atob(data.audio);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const blob = new Blob([bytes], { type: 'audio/mpeg' });
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          audio.oncanplaythrough = () => URL.revokeObjectURL(url);
          audio.play().catch(e => console.warn("Playback error", e));
        } catch (e) { console.error(e); }
      }
    };
    return () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.close();
      stopTranslation();
    };
  }, [sourceLang, targetLang]);

  const startTranslation = async () => {
    if (!isWsConnected) {
      setStatusMessage("Waiting for connection...");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      sourceNodeRef.current = source;

      const processor = audioContext.createScriptProcessor(4096, 1, 1);
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
      setStatusMessage(`Listening (${languageOptions[sourceLang]})...`);
    } catch (err) {
      setStatusMessage("Microphone access error. Please check permissions.");
    }
  };

  const stopTranslation = () => {
    if (processorRef.current) processorRef.current.disconnect();
    if (sourceNodeRef.current) sourceNodeRef.current.disconnect();
    if (audioContextRef.current) audioContextRef.current.close();
    if (mediaStreamRef.current) mediaStreamRef.current.getTracks().forEach(t => t.stop());
    setIsTranslating(false);
    setStatusMessage("Stopped");
  };

  const swapLanguages = () => {
    if (!isTranslating) {
      setSourceLang(targetLang);
      setTargetLang(sourceLang);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0B1120 0%, #19212E 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: "'Inter', system-ui",
      padding: '1rem'
    }}>
      <div style={{
        maxWidth: '750px',
        width: '100%',
        background: 'rgba(18, 25, 40, 0.75)',
        backdropFilter: 'blur(16px)',
        borderRadius: '2rem',
        border: '1px solid rgba(255,255,255,0.1)',
        padding: '2rem'
      }}>
        <h1 style={{ textAlign: 'center', color: 'white', marginBottom: '1rem' }}>Two-Way Translator</h1>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
          <select value={sourceLang} onChange={(e) => setSourceLang(e.target.value)} disabled={isTranslating} style={{ padding: '0.6rem 1rem', borderRadius: '2rem', background: '#1F2937', color: 'white', border: 'none' }}>
            {Object.entries(languageOptions).map(([code, name]) => (
              <option key={code} value={code}>{name}</option>
            ))}
          </select>
          <button onClick={swapLanguages} disabled={isTranslating} style={{ background: '#3B82F6', border: 'none', borderRadius: '2rem', padding: '0.6rem 1rem', color: 'white', cursor: 'pointer' }}>⇄</button>
          <select value={targetLang} onChange={(e) => setTargetLang(e.target.value)} disabled={isTranslating} style={{ padding: '0.6rem 1rem', borderRadius: '2rem', background: '#1F2937', color: 'white', border: 'none' }}>
            {Object.entries(languageOptions).map(([code, name]) => (
              <option key={code} value={code}>{name}</option>
            ))}
          </select>
        </div>

        <div style={{ background: 'rgba(0,0,0,0.35)', borderRadius: '1.5rem', padding: '1rem', marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.5rem' }}>
            <div style={{ width: '10px', height: '10px', borderRadius: '10px', background: isTranslating ? '#10B981' : (isWsConnected ? '#3B82F6' : '#EF4444') }} />
            <span style={{ color: '#9CA3AF' }}>{statusMessage}</span>
          </div>
        </div>

        <button onClick={isTranslating ? stopTranslation : startTranslation} disabled={!isWsConnected && !isTranslating} style={{
          width: '100%', padding: '1rem', borderRadius: '2rem', border: 'none', fontSize: '1.1rem', fontWeight: 600,
          background: isTranslating ? 'linear-gradient(135deg, #EF4444, #DC2626)' : 'linear-gradient(135deg, #3B82F6, #2563EB)',
          color: '#FFF', cursor: (isTranslating || isWsConnected) ? 'pointer' : 'not-allowed'
        }}>
          {isTranslating ? '🛑 Stop Translating' : '🎤 Start Translating'}
        </button>
      </div>
    </div>
  );
};

export default App;