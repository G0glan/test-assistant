import { useCallback, useMemo, useState } from "react";

type SpeechRecognitionCtor = new () => SpeechRecognition;

export function useVoice(onTranscript: (value: string) => void) {
  const [isListening, setIsListening] = useState(false);

  const recognition = useMemo(() => {
    const ctor = (window.SpeechRecognition || window.webkitSpeechRecognition) as SpeechRecognitionCtor | undefined;
    if (!ctor) {
      return null;
    }
    const instance = new ctor();
    instance.lang = "en-US";
    instance.continuous = false;
    instance.interimResults = false;
    instance.onresult = (event) => {
      const text = event.results[0]?.[0]?.transcript ?? "";
      if (text) {
        onTranscript(text);
      }
    };
    instance.onend = () => setIsListening(false);
    return instance;
  }, [onTranscript]);

  const toggleVoice = useCallback(() => {
    if (!recognition) {
      return;
    }
    if (isListening) {
      recognition.stop();
      setIsListening(false);
      return;
    }
    recognition.start();
    setIsListening(true);
  }, [isListening, recognition]);

  return { isListening, toggleVoice, supported: Boolean(recognition) };
}
