import React, { useState, useRef, useEffect } from 'react';

const App: React.FC = () => {
  // Récupération des langues depuis l'URL (src=fr&tgt=en)
  const urlParams = new URLSearchParams(window.location.search);
  const defaultSrc = urlParams.get('src') || 'fr';
  const defaultTgt = urlParams.get('tgt') || 'en';

  const [isTranslating, setIsTranslating] = useState(false);
  const [sourceLang, setSourceLang] = useState(defaultSrc);
  const [targetLang, setTargetLang] = useState(defaultTgt);
  const [statusMessage, setStatusMessage] = useState('Prêt');
  const [isWsConnected, setIsWsConnected] = useState(false);
  const [translatedText, setTranslatedText] = useState('');
  const [audioLevel, setAudioLevel] = useState(0); // pour l'animation du micro

  // Refs pour le WebSocket et l'audio
  const wsRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const speechQueue = useRef<string[]>([]);
  const isSpeaking = useRef(false);

  const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:8000/ws/translate';

  // Synthèse vocale avec file d'attente
  const speak = (text: string, lang: string) => {
    if (!window.speechSynthesis) return;
    speechQueue.current.push(text);
    if (!isSpeaking.current) processQueue(lang);
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

  // Connexion WebSocket
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
      setStatusMessage('Erreur serveur');
    };
    ws.onclose = () => {
      setIsWsConnected(false);
      setStatusMessage('Déconnecté');
    };
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'translated_text') {
        setTranslatedText(data.text);
        speak(data.text, targetLang);
      }
    };
    return () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.close();
      stopTranslation();
    };
  }, [sourceLang, targetLang, wsUrl]);

  // Capture audio et envoi des chunks
  const startTranslation = async () => {
    if (!isWsConnected) {
      setStatusMessage('Connexion WebSocket...');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      sourceNodeRef.current = source;

      // Analyseur pour le niveau sonore (animation)
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      source.connect(analyser);
      const updateLevel = () => {
        if (!isTranslating) return;
        analyser.getByteTimeDomainData(dataArray);
        let max = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const v = (dataArray[i] - 128) / 128;
          max = Math.max(max, Math.abs(v));
        }
        setAudioLevel(max);
        requestAnimationFrame(updateLevel);
      };
      updateLevel();

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
      setStatusMessage('🎙️ Écoute active');
    } catch (err) {
      setStatusMessage("❌ Micro non autorisé");
    }
  };

  const stopTranslation = () => {
    if (processorRef.current) processorRef.current.disconnect();
    if (sourceNodeRef.current) sourceNodeRef.current.disconnect();
    if (audioContextRef.current) audioContextRef.current.close();
    if (mediaStreamRef.current) mediaStreamRef.current.getTracks().forEach(t => t.stop());
    setIsTranslating(false);
    setStatusMessage('Arrêté');
    setAudioLevel(0);
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
    <div style={{
      minHeight: '100vh',
      background: 'radial-gradient(circle at 20% 30%, #0f172a, #020617)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
      padding: '1rem',
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* Carte principale glassmorphe */}
      <div style={{
        maxWidth: '800px',
        width: '100%',
        background: 'rgba(15, 25, 45, 0.55)',
        backdropFilter: 'blur(18px)',
        borderRadius: '3rem',
        border: '1px solid rgba(255,255,255,0.2)',
        boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1)',
        padding: '2rem',
        transition: 'all 0.3s ease'
      }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <h1 style={{
            fontSize: '2.8rem',
            fontWeight: 700,
            background: 'linear-gradient(135deg, #ffffff 0%, #a5b4fc 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            marginBottom: '0.25rem'
          }}>
            Traducteur Vocal
          </h1>
          <p style={{ color: '#94a3b8', fontSize: '0.85rem', letterSpacing: '0.5px' }}>
            Son → Son • Temps réel • IA
          </p>
        </div>

        {/* Sélecteurs de langue */}
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          gap: '1.5rem',
          marginBottom: '2.5rem',
          flexWrap: 'wrap'
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '1px', color: '#8b9eb0' }}>Je parle</div>
            <select
              value={sourceLang}
              onChange={(e) => setSourceLang(e.target.value)}
              disabled={isTranslating}
              style={{
                background: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '2rem',
                padding: '0.5rem 1.5rem',
                color: '#f1f5f9',
                fontWeight: 500,
                fontSize: '1rem',
                cursor: isTranslating ? 'default' : 'pointer',
                transition: 'all 0.2s',
                outline: 'none'
              }}
            >
              <option value="fr">🇫🇷 Français</option>
              <option value="en">🇬🇧 English</option>
            </select>
          </div>
          <button
            onClick={swapLanguages}
            disabled={isTranslating}
            style={{
              background: '#3b82f6',
              border: 'none',
              borderRadius: '3rem',
              width: '48px',
              height: '48px',
              fontSize: '1.5rem',
              cursor: isTranslating ? 'default' : 'pointer',
              transition: 'transform 0.2s',
              boxShadow: '0 4px 12px rgba(59,130,246,0.4)'
            }}
            onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
            onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
          >
            ⇄
          </button>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '1px', color: '#8b9eb0' }}>J'écoute</div>
            <select
              value={targetLang}
              onChange={(e) => setTargetLang(e.target.value)}
              disabled={isTranslating}
              style={{
                background: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '2rem',
                padding: '0.5rem 1.5rem',
                color: '#f1f5f9',
                fontWeight: 500,
                fontSize: '1rem',
                cursor: isTranslating ? 'default' : 'pointer',
                outline: 'none'
              }}
            >
              <option value="en">🇬🇧 English</option>
              <option value="fr">🇫🇷 Français</option>
            </select>
          </div>
        </div>

        {/* Bouton principal et animation du micro */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '2rem', position: 'relative' }}>
          <div style={{ position: 'relative' }}>
            {/* Anneau d'onde sonore (visible uniquement en écoute) */}
            {isTranslating && (
              <div style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                width: `${120 + audioLevel * 80}px`,
                height: `${120 + audioLevel * 80}px`,
                transform: 'translate(-50%, -50%)',
                borderRadius: '50%',
                background: 'rgba(59,130,246,0.2)',
                transition: 'width 0.1s ease-out, height 0.1s ease-out',
                pointerEvents: 'none',
                zIndex: 0
              }} />
            )}
            <button
              onClick={isTranslating ? stopTranslation : startTranslation}
              disabled={!isWsConnected && !isTranslating}
              style={{
                position: 'relative',
                width: '100px',
                height: '100px',
                borderRadius: '50%',
                background: isTranslating
                  ? 'linear-gradient(135deg, #ef4444, #dc2626)'
                  : 'linear-gradient(135deg, #3b82f6, #2563eb)',
                border: 'none',
                cursor: (isTranslating || isWsConnected) ? 'pointer' : 'not-allowed',
                boxShadow: '0 10px 25px -5px rgba(0,0,0,0.3), 0 0 0 2px rgba(255,255,255,0.1)',
                transition: 'transform 0.2s, box-shadow 0.2s',
                fontSize: '3rem',
                color: 'white',
                zIndex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
              onMouseEnter={(e) => {
                if ((isTranslating || isWsConnected)) e.currentTarget.style.transform = 'scale(1.05)';
              }}
              onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
            >
              {isTranslating ? '⏹️' : '🎤'}
            </button>
          </div>
        </div>

        {/* Statut connecté */}
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem' }}>
          <div style={{
            width: '10px',
            height: '10px',
            borderRadius: '10px',
            background: isTranslating ? '#10b981' : (isWsConnected ? '#3b82f6' : '#ef4444'),
            boxShadow: isTranslating ? '0 0 8px #10b981' : 'none',
            transition: 'all 0.2s'
          }} />
          <span style={{ color: '#94a3b8', fontSize: '0.8rem', fontWeight: 500 }}>{statusMessage}</span>
        </div>

        {/* Zone de traduction */}
        <div style={{
          background: 'rgba(0,0,0,0.4)',
          borderRadius: '1.5rem',
          padding: '1.2rem',
          minHeight: '120px',
          marginBottom: '1.5rem',
          border: '1px solid rgba(255,255,255,0.05)',
          transition: 'all 0.2s'
        }}>
          <div style={{ fontSize: '0.7rem', color: '#8b9eb0', marginBottom: '0.5rem' }}>TRADUCTION</div>
          <div style={{
            color: '#f1f5f9',
            fontSize: '1.2rem',
            fontWeight: 500,
            wordBreak: 'break-word',
            lineHeight: 1.5
          }}>
            {translatedText || "✨ La traduction apparaîtra ici..."}
          </div>
        </div>

        <div style={{ fontSize: '0.7rem', textAlign: 'center', color: '#475569' }}>
          🔒 Audio local • Deepgram + Mistral/MyMemory • Synthèse vocale intégrée
        </div>
      </div>
    </div>
  );
};

export default App;