import type { Lang } from "@/lib/voiceActions";

/** Spanish when the browser prefers it, else English. */
export function browserLang(): Lang {
  if (typeof navigator === "undefined") return "en";
  return navigator.languages?.some((l) => l.toLowerCase().startsWith("es")) || navigator.language?.toLowerCase().startsWith("es")
    ? "es"
    : "en";
}

export function monthYear(date: Date, lang: Lang) {
  return new Intl.DateTimeFormat(lang, { month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}

export const STRINGS = {
  en: {
    pill: "Ask the reef",
    status: {
      idle: "Tap the mic or press V to talk",
      listening: "Listening… speak naturally, or press V to end",
      transcribing: "Connecting…",
      thinking: "Checking the data…",
      speaking: "Speaking… tap the mic or press V to stop",
    },
    placeholder: "Or type a question and press Enter",
    close: "Close (Esc)",
    replay: "Replay",
    clear: "Clear",
    checked: "Checked",
    guide: "Spoken guide",
    talk: "Talk",
    send: "Send",
    stop: "Stop speaking",
    notHeard: "I didn't catch that. Try again.",
    suggestions: {
      reef: ["Where am I?", "Why is this reef stressed?", "Take me back up"],
      region: ["Take me to Looe Key", "Which reef was hottest in 2023?", "What can I say?"],
      flagship: ["What happened here in 2019?", "What is missing from this record?", "Take me to Lizard Island"],
      world: ["Take me to Moorea", "Which reef has the longest record?", "Show me Florida"],
    },
    enterGuide: "Enter with spoken guide",
    enterGuideHint: "Narrates each scene. Press V anytime to talk.",
    welcome: "Welcome to Reef Atlas. Flying to Florida's Coral Reef.",
    region: (month: string) =>
      `You're above Florida's Coral Reef: nine reefs from Biscayne to the Dry Tortugas, shown in ${month}. Press V and say a reef name to dive in, or ask a question. Say "what can I say" for help.`,
    reefArrive: (name: string, region: string) => `${name}, ${region}.`,
    reefHint: `Press V to ask about this reef, or say "take me back up".`,
    world:
      "The whole ocean, coloured by each reef's heat stress. Four places have records long enough to show what happened between surveys: Moorea, Lizard Island, Soneva Fushi and Florida. Choose one.",
    flagshipArrive: (name: string, role: string) => `${name}. ${role}.`,
    splatArrive: (plot: string) => `Inside a real 3D survey of ${plot}. Use the dates to see the same reef on other days.`,
    // Touch-only screens: taps instead of keys
    touch: {
      status: {
        idle: "Tap the mic to talk",
        listening: "Listening… speak naturally, or tap the mic to end",
        speaking: "Speaking… tap the mic to stop",
      },
      placeholder: "Or type a question",
      close: "Close",
      enterGuideHint: 'Narrates each scene. Tap "Ask the reef" anytime to talk.',
      region: (month: string) =>
        `You're above Florida's Coral Reef: nine reefs from Biscayne to the Dry Tortugas, shown in ${month}. Tap "Ask the reef" and say a reef name to dive in, or ask a question. Say "what can I say" for help.`,
      reefHint: `Tap "Ask the reef" to ask about this reef, or say "take me back up".`,
    },
  },
  es: {
    pill: "Pregunta al arrecife",
    status: {
      idle: "Toca el micrófono o pulsa V para hablar",
      listening: "Escuchando… habla, o pulsa V para terminar",
      transcribing: "Conectando…",
      thinking: "Consultando los datos…",
      speaking: "Hablando… toca el micrófono o pulsa V para parar",
    },
    placeholder: "O escribe una pregunta y pulsa Enter",
    close: "Cerrar (Esc)",
    replay: "Repetir",
    clear: "Borrar",
    checked: "Consultado",
    guide: "Guía hablada",
    talk: "Hablar",
    send: "Enviar",
    stop: "Dejar de hablar",
    notHeard: "No te he entendido. Inténtalo de nuevo.",
    suggestions: {
      reef: ["¿Dónde estoy?", "¿Por qué sufre este arrecife?", "Llévame arriba"],
      region: ["Llévame a Looe Key", "¿Qué arrecife tuvo más calor en 2023?", "¿Qué puedo decir?"],
      flagship: ["¿Qué pasó aquí en 2019?", "¿Qué falta en este registro?", "Llévame a Lizard Island"],
      world: ["Llévame a Moorea", "¿Qué arrecife tiene el registro más largo?", "Muéstrame Florida"],
    },
    enterGuide: "Entrar con guía hablada",
    enterGuideHint: "Narra cada escena. Pulsa V para hablar.",
    welcome: "Bienvenido a Reef Atlas. Volando al arrecife de coral de Florida.",
    region: (month: string) =>
      `Estás sobre el arrecife de coral de Florida: nueve arrecifes desde Biscayne hasta Dry Tortugas, en ${month}. Pulsa V y di el nombre de un arrecife para sumergirte, o haz una pregunta. Di "qué puedo decir" para obtener ayuda.`,
    reefArrive: (name: string, region: string) => `${name}, ${region}.`,
    reefHint: `Pulsa V para preguntar sobre este arrecife, o di "llévame arriba".`,
    world:
      "Todo el océano, coloreado por el estrés térmico de cada arrecife. Cuatro lugares tienen registros lo bastante largos para mostrar qué pasó entre muestreos: Moorea, Lizard Island, Soneva Fushi y Florida. Elige uno.",
    flagshipArrive: (name: string, role: string) => `${name}. ${role}.`,
    splatArrive: (plot: string) => `Dentro de un modelo 3D real de ${plot}. Usa las fechas para ver el mismo arrecife otros días.`,
    touch: {
      status: {
        idle: "Toca el micrófono para hablar",
        listening: "Escuchando… habla, o toca el micrófono para terminar",
        speaking: "Hablando… toca el micrófono para parar",
      },
      placeholder: "O escribe una pregunta",
      close: "Cerrar",
      enterGuideHint: 'Narra cada escena. Toca "Pregunta al arrecife" para hablar.',
      region: (month: string) =>
        `Estás sobre el arrecife de coral de Florida: nueve arrecifes desde Biscayne hasta Dry Tortugas, en ${month}. Toca "Pregunta al arrecife" y di el nombre de un arrecife para sumergirte, o haz una pregunta. Di "qué puedo decir" para obtener ayuda.`,
      reefHint: `Toca "Pregunta al arrecife" para preguntar sobre este arrecife, o di "llévame arriba".`,
    },
  },
} satisfies Record<Lang, unknown>;

/** Strings for a language, with tap wording in place of key hints on touch-only screens. */
export function strings(lang: Lang, touch: boolean) {
  const s = STRINGS[lang];
  return touch ? { ...s, ...s.touch, status: { ...s.status, ...s.touch.status } } : s;
}
