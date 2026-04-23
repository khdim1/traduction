import React, { useState, useCallback, useEffect, useRef } from 'react';
import { PalabraClient, getLocalAudioTrack } from '@palabra-ai/translator';

type Language = 'fr' | 'en' | 'es' | 'de' | 'it'; // Ajoutez les langues supportées

const App: React.FC = () => {
  const [isTranslating, setIsTranslating] = useState(false);
  const [sourceLang, setSourceLang] = useState<Language>('fr');
  const [targetLang, setTargetLang] = useState<Language>('en');
  const [transcription, setTranscription] = useState('');
  const [translation, setTranslation] = useState('');
  const [status, setStatus] = useState('Prêt');
  const clientRef = useRef<PalabraClient | null>(null);

  // Clés API (à retirer ensuite dans un fichier .env)
  const CLIENT_ID = "5e4c1125b52d05521f4706fafd436dbf";
  const CLIENT_SECRET = "861f2717610ee8c4794fb3c92dc89e2819cd33264c2fa93d5d4ddd6fbe68645a";

  const speak = (text: string, lang: string) => {
    if (!window.speechSynthesis) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang === 'en' ? 'en-US' : 'fr-FR';
    utterance.rate = 0.9;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  };

  const startTranslation = useCallback(async () => {
    try {
      setStatus('Connexion...');
      const client = new PalabraClient({
        auth: { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET },
        translateFrom: sourceLang,
        translateTo: targetLang,
        handleOriginalTrack: getLocalAudioTrack,
      });

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

  const stopTranslation = useCallback(async () => {
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

  useEffect(() => {
    return () => {
      if (clientRef.current) {
        clientRef.current.stopPlayback();
        clientRef.current.stopTranslation();
      }
    };
  }, []);

  const swap = () => {
    if (!isTranslating) {
      setSourceLang(targetLang);
      setTargetLang(sourceLang);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0f172a, #020617)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div style={{ background: 'rgba(15,25,45,0.75)', backdropFilter: 'blur(18px)', borderRadius: '2rem', padding: '2rem', maxWidth: '700px', width: '100%', border: '1px solid rgba(255,255,255,0.1)' }}>
        <h1 style={{ textAlign: 'center', fontSize: '2rem', background: 'linear-gradient(135deg, #fff, #a5b4fc)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Interprète IA</h1>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', margin: '1.5rem 0' }}>
          <select value={sourceLang} onChange={(e) => setSourceLang(e.target.value as Language)} disabled={isTranslating} style={{ background: '#1e293b', padding: '0.5rem 1rem', borderRadius: '2rem', color: 'white', border: 'none' }}>
            <option value="fr">Français 🇫🇷</option>
            <option value="en">English 🇬🇧</option>
          </select>
          <button onClick={swap} disabled={isTranslating} style={{ background: '#3b82f6', border: 'none', borderRadius: '3rem', width: '48px', fontSize: '1.5rem', color: 'white', cursor: 'pointer' }}>⇄</button>
          <select value={targetLang} onChange={(e) => setTargetLang(e.target.value as Language)} disabled={isTranslating} style={{ background: '#1e293b', padding: '0.5rem 1rem', borderRadius: '2rem', color: 'white', border: 'none' }}>
            <option value="en">English 🇬🇧</option>
            <option value="fr">Français 🇫🇷</option>
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
          🔒 Palabra.ai (WebRTC) • Traduction temps réel • Synthèse vocale intégrée
        </div>
      </div>
    </div>
  );
};

export default App;