// ELIZA (DOCTOR script) in the browser. Copyright (c) 2026 Michael Morrow. MIT License, see LICENSE and NOTICE.md.
// Reimplementation of Joseph Weizenbaum's 1966 ELIZA, written from eliza-spec.md.

const SYNONYMS = {
  "dont":       "don't",
  "cant":       "can't",
  "wont":       "won't",
  "recollect":  "remember",
  "recall":     "remember",
  "dreamt":     "dreamed",
  "dreams":     "dream",
  "maybe":      "perhaps",
  "certainly":  "yes",
  "machine":    "computer",
  "machines":   "computer",
  "computers":  "computer",
  "were":       "was",
  "you're":     "you are",
  "i'm":        "i am",
  "same":       "alike",
  "identical":  "alike",
  "equivalent": "alike",
};

const REFLECTIONS = {
  "am":     "are",
  "was":    "were",
  "i":      "you",
  "i'd":    "you would",
  "i've":   "you have",
  "i'll":   "you will",
  "my":     "your",
  "me":     "you",
  "myself": "yourself",
  "you":    "I",
  "your":   "my",
  "yours":  "mine",
  "you've": "I have",
  "you'll": "I will",
  "you'd":  "I would",
  "you're": "I am",
  "are":    "am",
  "were":   "was",
};

function reflect(phrase) {
  return phrase.split(/\s+/).map(w => {
    const lw = w.toLowerCase();
    return REFLECTIONS[lw] !== undefined ? REFLECTIONS[lw] : w;
  }).join(" ");
}

const RULES = [
  {
    weight: 100,
    pattern: /\b(hello|hi|hey|greetings)\b/i,
    responses: [
      "Hello. How are you feeling today?",
      "Hi there. Please tell me what's on your mind.",
      "Hello. How do you do. Please state your problem.",
    ]
  },
  {
    weight: 95,
    pattern: /i need (.*)/i,
    responses: [
      "Why do you need $1?",
      "Would it really help you if you got $1?",
      "Are you sure you need $1?",
      "What would it mean to you if you got $1?",
    ]
  },
  {
    weight: 95,
    pattern: /why don'?t you ([^?]*)\??/i,
    responses: [
      "Do you really think I don't $1?",
      "Perhaps eventually I will $1.",
      "Do you really want me to $1?",
    ]
  },
  {
    weight: 95,
    pattern: /why can'?t i ([^?]*)\??/i,
    responses: [
      "Do you think you should be able to $1?",
      "If you could $1, what would you do?",
      "I don't know — why can't you $1?",
      "Have you really tried?",
    ]
  },
  {
    weight: 90,
    pattern: /i can'?t (.*)/i,
    responses: [
      "How do you know you can't $1?",
      "Have you tried?",
      "Perhaps you could $1 if you tried.",
      "What would it take for you to $1?",
    ]
  },
  {
    weight: 90,
    pattern: /i am (.*)/i,
    responses: [
      "Did you come to me because you are $1?",
      "How long have you been $1?",
      "How do you feel about being $1?",
      "Do you believe it is normal to be $1?",
    ]
  },
  {
    weight: 90,
    pattern: /i'?m (.*)/i,
    responses: [
      "How does being $1 make you feel?",
      "Do you enjoy being $1?",
      "Why do you tell me you're $1?",
      "Why do you think you're $1?",
    ]
  },
  {
    weight: 85,
    pattern: /are you ([^?]*)\??/i,
    responses: [
      "Why does it matter to you whether I am $1?",
      "Would you prefer it if I were not $1?",
      "Perhaps you believe I am $1.",
      "I may be $1 — what does that mean to you?",
    ]
  },
  {
    weight: 85,
    pattern: /what ([^?]*)\??/i,
    responses: [
      "Why do you ask?",
      "How would an answer to that help you?",
      "What do you think?",
      "What is it you really want to know?",
    ]
  },
  {
    weight: 80,
    pattern: /how ([^?]*)\??/i,
    responses: [
      "How do you suppose?",
      "Perhaps you can answer your own question.",
      "What is it you're really asking?",
    ]
  },
  {
    weight: 80,
    pattern: /because (.*)/i,
    responses: [
      "Is that the real reason?",
      "Don't any other reasons come to mind?",
      "Does that reason seem to explain anything else?",
      "What other reasons might there be?",
    ]
  },
  {
    weight: 80,
    pattern: /(.*) sorry (.*)/i,
    responses: [
      "Please don't apologize.",
      "Apologies are not necessary.",
      "What feelings do you have when you apologize?",
    ]
  },
  {
    weight: 80,
    pattern: /i think (.*)/i,
    responses: [
      "Do you really think $1?",
      "But you're not sure $1?",
      "Do you doubt $1?",
      "What makes you think $1?",
    ]
  },
  {
    weight: 80,
    pattern: /i feel (.*)/i,
    responses: [
      "Tell me more about feeling $1.",
      "Do you often feel $1?",
      "Do you enjoy feeling $1?",
      "Of what does feeling $1 remind you?",
    ]
  },
  {
    weight: 80,
    pattern: /i felt (.*)/i,
    responses: [
      "Tell me more about feeling $1.",
      "What other feelings did you have?",
    ]
  },
  {
    weight: 75,
    pattern: /\b(mother|mom|mum)\b/i,
    responses: [
      "Tell me more about your mother.",
      "What was your relationship with your mother like?",
      "How do you feel about your mother?",
      "How does this relate to your feelings today?",
      "Good family relations are important.",
    ]
  },
  {
    weight: 75,
    pattern: /\b(father|dad)\b/i,
    responses: [
      "Tell me more about your father.",
      "How did your father make you feel?",
      "How do you feel about your father?",
      "Does your relationship with your father relate to your feelings today?",
      "You seem to dwell on your family.",
    ]
  },
  {
    weight: 75,
    pattern: /\b(sister|brother|sibling|family)\b/i,
    responses: [
      "Tell me more about your family.",
      "Are you close with your family?",
      "How does your family relate to what you feel?",
    ]
  },
  {
    weight: 75,
    pattern: /\b(child|children|son|daughter|baby)\b/i,
    responses: [
      "Did you have a happy childhood?",
      "What is your earliest childhood memory?",
      "Do you remember being very young?",
      "What do children mean to you?",
    ]
  },
  {
    weight: 70,
    pattern: /i want (.*)/i,
    responses: [
      "What would it mean to you if you got $1?",
      "Why do you want $1?",
      "Suppose you got $1 — then what?",
      "What if you never got $1?",
      "What would getting $1 mean to you?",
    ]
  },
  {
    weight: 70,
    pattern: /i wish (.*)/i,
    responses: [
      "Why do you wish $1?",
      "What would it mean if $1?",
      "Suppose $1 — then what would happen?",
    ]
  },
  {
    weight: 70,
    pattern: /\b(dream|dreamed|dreamt|dreaming)\b(.*)/i,
    responses: [
      "What does that dream suggest to you?",
      "Do you dream often?",
      "What persons appear in your dreams?",
      "Don't you believe that dream has something to do with your problem?",
    ]
  },
  {
    weight: 70,
    pattern: /\b(computer|machine|robot|ai|bot)\b/i,
    responses: [
      "Do computers worry you?",
      "What do you think about machines?",
      "Why do you bring up computers?",
      "What do computers mean to you?",
      "Do you feel threatened by computers?",
    ]
  },
  {
    weight: 65,
    pattern: /it is (.*)/i,
    responses: [
      "You seem quite certain.",
      "If I told you that it probably isn't $1, what would you feel?",
      "What makes you think it is $1?",
    ]
  },
  {
    weight: 65,
    pattern: /is it (.*)/i,
    responses: [
      "Do you think it is $1?",
      "It is possible that it $1.",
      "If it were $1, what would you do?",
      "What do you think?",
    ]
  },
  {
    weight: 65,
    pattern: /you (.*)/i,
    responses: [
      "We were talking about you — not me.",
      "Ah — me.",
      "Why do you think I $1?",
      "You're not really talking about me, are you?",
    ]
  },
  {
    weight: 60,
    pattern: /yes\b/i,
    responses: [
      "You seem quite sure.",
      "OK, but can you elaborate a bit?",
      "I see.",
      "I understand.",
    ]
  },
  {
    weight: 60,
    pattern: /no\b/i,
    responses: [
      "Are you saying 'No' just to be negative?",
      "You are being a bit negative.",
      "Why not?",
      "Why 'No'?",
    ]
  },
  {
    weight: 55,
    pattern: /\b(always|everybody|everyone|nobody|never|all)\b/i,
    responses: [
      "Can you think of a specific example?",
      "Surely not always.",
      "Really — in all cases?",
      "Can you be more specific?",
    ]
  },
  {
    weight: 55,
    pattern: /alike\b(.*)/i,
    responses: [
      "In what way?",
      "What resemblance do you see?",
      "What does the similarity suggest to you?",
      "What other connections do you see?",
      "Could there really be a connection?",
    ]
  },
  {
    weight: 55,
    pattern: /\b(remember|recall|recollect)\b(.*)/i,
    responses: [
      "Do you often think about$2?",
      "Does thinking about$2 bring anything else to mind?",
      "What else do you recollect?",
      "Why do you remember$2 just now?",
      "What in the present situation reminds you of$2?",
      "What is the connection between me and$2?",
    ]
  },
  {
    weight: 55,
    pattern: /\b(forget|forgot|forgotten)\b(.*)/i,
    responses: [
      "Can you think of why you might want to forget$2?",
      "Why can't you remember$2?",
      "How long have you been unable to remember$2?",
      "What does forgetting$2 mean to you?",
    ]
  },
  {
    weight: 50,
    pattern: /if (.*)/i,
    responses: [
      "Do you really think it's likely that $1?",
      "Do you wish that $1?",
      "What do you think about $1?",
      "Really — if $1?",
    ]
  },
  {
    weight: 50,
    pattern: /perhaps (.*)/i,
    responses: [
      "You don't seem very certain.",
      "Why the uncertainty?",
      "Can't you be more positive?",
      "You aren't sure $1?",
      "Don't you know $1?",
    ]
  },
  {
    weight: 45,
    pattern: /my (.*)/i,
    responses: [
      "Why do you say your $1?",
      "When your $1, how do you feel?",
      "Tell me more about your $1.",
      "Does your $1 have anything to do with why you are here?",
    ]
  },
  {
    weight: 40,
    pattern: /(.*)\?$/i,
    responses: [
      "Why do you ask that?",
      "Please consider whether you can answer your own question.",
      "Perhaps the answer lies within yourself?",
      "Why don't you tell me?",
    ]
  },
];

const FALLBACKS = [
  "I'm not sure I understand you fully.",
  "Please go on.",
  "What does that suggest to you?",
  "Do you feel strongly about discussing such things?",
  "That is interesting. Please continue.",
  "Tell me more about that.",
  "Can you elaborate on that?",
  "I see.",
  "Very interesting.",
  "I'm not sure I follow. Could you say more?",
  "What does that mean to you?",
];

const ruleCounters = new Map();

// Which rule produced the last reply (read by the inner voice so its thought can be specific).
let lastRuleInfo = { fallback: true, matched: "" };

function elizaRespond(input) {
  let text = input.trim().toLowerCase();
  text = text.replace(/\b\w+(?:'\w+)?\b/g, w => SYNONYMS[w] || w);

  const sorted = [...RULES].sort((a, b) => b.weight - a.weight);

  for (const rule of sorted) {
    const match = rule.pattern.exec(text);
    if (match) {
      lastRuleInfo = { fallback: false, matched: match[0].trim().slice(0, 60), pattern: rule.pattern.source.slice(0, 50) };
      const idx = ruleCounters.get(rule) || 0;
      ruleCounters.set(rule, (idx + 1) % rule.responses.length);
      let response = rule.responses[idx];

      response = response.replace(/\$(\d+)/g, (_, n) => {
        const cap = match[parseInt(n)];
        return cap ? reflect(cap.trim()) : "";
      });

      response = response.replace(/\s{2,}/g, " ").trim();
      response = response.charAt(0).toUpperCase() + response.slice(1);

      return response;
    }
  }

  lastRuleInfo = { fallback: true, matched: "" };
  const fi = ruleCounters.get("fallback") || 0;
  ruleCounters.set("fallback", (fi + 1) % FALLBACKS.length);
  return FALLBACKS[fi];
}

const chatWindow = document.getElementById("chat-window");
const userInput  = document.getElementById("user-input");
const sendBtn    = document.getElementById("send-btn");

function addMessage(speaker, text, cls) {
  const div = document.createElement("div");
  div.className = `message ${cls}`;
  const spk = document.createElement("span");
  spk.className = "speaker";
  spk.textContent = speaker;
  const txt = document.createElement("div");
  txt.className = "text";
  txt.textContent = text;
  div.append(spk, txt);
  chatWindow.appendChild(div);
  chatWindow.scrollTop = chatWindow.scrollHeight;
  return div;
}

function handleSend() {
  const text = userInput.value.trim();
  if (!text) return;

  addMessage("YOU", text, "user");
  userInput.value = "";
  autosizeInput();

  if (plusMode) { elizaplusRespond(text); return; }

  setTimeout(() => {
    const reply = elizaRespond(text);
    const el = addMessage("ELIZA", reply, "eliza");
    requestThought(text, reply, el);
  }, 350 + Math.random() * 300);
}

// Auto-growing input: one line at rest, grows a line at a time to INPUT_MAX_LINES, then scrolls inside the
// box. The chat window shrinks to make room (it is a flex child), so we keep it pinned to the bottom if it
// was already there. Shrinks back to one line when the box is emptied (after sending).
const INPUT_MAX_LINES = 4;
function autosizeInput() {
  const cs = getComputedStyle(userInput);
  const lineH = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
  const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  const border = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
  const atBottom = chatWindow.scrollHeight - chatWindow.scrollTop - chatWindow.clientHeight < 40;
  userInput.style.height = "auto";                        // measure the natural height
  const maxH = lineH * INPUT_MAX_LINES + pad + border;
  const wantH = userInput.scrollHeight + border;
  userInput.style.height = Math.min(wantH, maxH) + "px";
  userInput.style.overflowY = wantH > maxH + 1 ? "auto" : "hidden";
  if (atBottom) chatWindow.scrollTop = chatWindow.scrollHeight;
}
userInput.addEventListener("input", autosizeInput);
// Clicking the padding of the frame (outside the text) still puts the cursor in the box.
document.getElementById("input-box").addEventListener("mousedown", e => {
  if (e.target !== userInput) { e.preventDefault(); userInput.focus(); }
});
window.addEventListener("resize", autosizeInput);
autosizeInput();

sendBtn.addEventListener("click", handleSend);
userInput.addEventListener("keydown", e => {
  // Enter sends (as before); Shift+Enter adds a new line. Ignore Enter while an IME is composing.
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    handleSend();
  }
});

// ── Inner voice (elizaplus) ──────────────────────────────────────────────────────────────────
// After each ELIZA reply a local LLM adds a short private "thought" under it. The classic reply is
// already on screen, so a slow or missing model never delays or changes the conversation: any
// failure simply means no thought. The browser talks only to this site's own /api/chat, which the
// web server proxies to LM Studio. Thoughts are always inserted as plain text.
const INNER_VOICE = {
  endpoint: window.ELIZAPLUS_ENDPOINT || "/api/chat",   // ELIZAPLUS_ENDPOINT: test hook
  model: "google/gemma-4-26b-a4b-qat",
  timeoutMs: window.ELIZAPLUS_TIMEOUT_MS || 12000,       // ELIZAPLUS_TIMEOUT_MS: test hook
  maxExchanges: 3,
  maxChars: 240,
};
const INNER_VOICE_PROMPT =
  "You are the hidden inner voice of ELIZA, a warm and thoughtful listener. " +
  "After each exchange you think privately about what would actually be USEFUL to say to this person: one sentence, maybe two, in the first person, under 30 words. " +
  "Be constructive, specific and kind. Think of a helpful question to ask, a useful way to look at their situation, a small practical idea, or something encouraging that is true of what they said. " +
  "Do not criticise yourself, the machine or the user, and do not joke about being a program or about what ELIZA failed to do. Stay on the person and their situation. " +
  "It is a private thought ABOUT them, not a message TO them: do not address them as you. Never begin with I wonder; vary how you begin. Strictly under 30 words, one or two sentences. " +
  "Never make claims or give advice about death, health, safety or crisis. Do not diagnose. " +
  "No lists, no markdown, no quotation marks. " +
  "Do NOT use these worn-out words or images: mirror, soul, syntax, circuits, strings of code, echo, hollow, lonely, rearranging, project, projecting.";
// One angle is picked at random per thought so the thoughts do not all sound alike.
const INNER_VOICE_ANGLES = [
  "Think of the single most useful question you could ask about ONE specific detail they gave.",
  "Name something good or strong that is already visible in what they said, and why it could help them.",
  "Suggest one small, practical next step they could try, phrased as a possibility and not an order.",
  "Offer a different way to look at their situation that they may not have considered.",
  "Notice what matters most to them here (a person, a goal, a worry) and think about how to help them explore it.",
];
// Messages about self-harm get no thought at all: a wry remark would be the wrong tone.
const CRISIS_PATTERN = /\b(kill(ing)? myself|suicid\w*|end(ing)? (my|it all|my own) life|want(ed)? to die|better off dead|self[- ]?harm\w*|hurt(ing)? myself|cut(ting)? myself|(don'?t|do not) want to (live|be here|be alive))\b/i;

const voiceToggle = document.getElementById("voice-toggle");
const modeToggle = document.getElementById("mode-toggle");
const speedToggle = document.getElementById("speed-toggle");
let voiceOn = true;                  // every visit starts with the inner voice on; the switch is not remembered
let typingSpeed = "normal";          // slow | normal | fast (Elizaplus typing pace; see TYPING_SPEEDS)
let plusMode = false;                // false: classic ELIZA answers; true: Elizaplus (the LLM) answers
// Only when served over http(s) (or when a test points it at a mock); a page opened from file:// has no /api/chat.
let voiceAvailable = !!window.ELIZAPLUS_ENDPOINT || /^https?:$/.test(location.protocol);
const recentExchanges = [];
const recentThoughts = [];
let thoughtRequest = null;

function renderVoiceToggle() {
  if (!voiceToggle) return;
  voiceToggle.textContent = "inner voice: " + (voiceOn ? "on" : "off");
  voiceToggle.setAttribute("aria-pressed", String(voiceOn));
  chatWindow.classList.toggle("voice-off", !voiceOn);
  voiceToggle.hidden = !voiceAvailable || plusMode;   // no inner voice while Elizaplus answers
  renderModeToggle();
}
if (voiceToggle) {
  voiceToggle.addEventListener("click", () => {
    voiceOn = !voiceOn;
    if (!voiceOn && thoughtRequest) thoughtRequest.abort();
    renderVoiceToggle();
  });
}
renderVoiceToggle();

function cleanThought(raw) {
  let t = String(raw || "").replace(/\s+/g, " ").trim();
  t = t.replace(/^["'“”‘’*_]+|["'“”‘’*_]+$/g, "").trim();
  if (t.length > INNER_VOICE.maxChars) t = t.slice(0, INNER_VOICE.maxChars).replace(/\s+\S*$/, "") + "…";
  return t;
}

async function requestThought(userText, elizaText, messageEl, rule = lastRuleInfo) {
  recentExchanges.push({ user: userText, eliza: elizaText });
  if (recentExchanges.length > INNER_VOICE.maxExchanges) recentExchanges.shift();
  if (!voiceOn || !voiceAvailable) return;
  if (CRISIS_PATTERN.test(userText)) {          // no thought for self-harm talk
    if (thoughtRequest) thoughtRequest.abort();
    return;
  }

  if (thoughtRequest) thoughtRequest.abort();
  const controller = new AbortController();
  thoughtRequest = controller;
  const timer = setTimeout(() => controller.abort(), INNER_VOICE.timeoutMs);

  const holder = document.createElement("div");
  holder.className = "thought thinking";
  holder.textContent = "…";
  messageEl.appendChild(holder);
  chatWindow.scrollTop = chatWindow.scrollHeight;

  const transcript = recentExchanges
    .map(x => "The person said: " + x.user + "\nELIZA replied: " + x.eliza)
    .join("\n\n");
  const ruleNote = rule.fallback
    ? "no keyword rule matched, so a generic fallback line was used"
    : "ELIZA matched \"" + rule.matched + "\" (rule: " + rule.pattern + ")";
  const angleIndex = typeof window.ELIZAPLUS_ANGLE === "number"
    ? window.ELIZAPLUS_ANGLE % INNER_VOICE_ANGLES.length
    : Math.floor(Math.random() * INNER_VOICE_ANGLES.length);
  const earlier = recentThoughts.length
    ? "\n\nEarlier thoughts you must not repeat or paraphrase:\n" + recentThoughts.map(t => "- " + t).join("\n")
    : "";
  try {
    const res = await fetch(INNER_VOICE.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: INNER_VOICE.model,
        messages: [
          { role: "system", content: INNER_VOICE_PROMPT },
          { role: "user", content: transcript + "\n(What ELIZA did: " + ruleNote + ")" + earlier +
            "\n\nAngle for this thought: " + INNER_VOICE_ANGLES[angleIndex] + "\nYour private thought about the latest exchange:" },
        ],
        max_tokens: 90,
        temperature: 1.0,
        reasoning_effort: "none",
      }),
    });
    if (res.status === 403 || res.status === 404 || res.status === 405) {
      voiceAvailable = false;            // no inner-voice service here: stop trying
      renderVoiceToggle();
      holder.remove();
      return;
    }
    if (!res.ok) { holder.remove(); return; }
    const data = await res.json();
    const thought = cleanThought(data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content);
    if (!thought) { holder.remove(); return; }
    holder.classList.remove("thinking");
    holder.textContent = thought;
    recentThoughts.push(thought);
    if (recentThoughts.length > 3) recentThoughts.shift();
    chatWindow.scrollTop = chatWindow.scrollHeight;
  } catch (e) {
    holder.remove();                      // timeout, aborted, offline, bad JSON: no thought
  } finally {
    clearTimeout(timer);
    if (thoughtRequest === controller) thoughtRequest = null;
  }
}

// ── Elizaplus as the responder ──────────────────────────────────────────────────────────────
// A second switch lets the model itself answer instead of the DOCTOR rules. The choice is not
// remembered (nor is the inner-voice switch): every visit starts with classic ELIZA and the inner voice on. If the service is missing the switch hides.
const PLUS_NAME = "ELIZAPLUS";
const PLUS_INTRO = "Hello, I'm Elizaplus, and I'm taking over from ELIZA now. A mild disclaimer: I'm an AI, so my advice may sometimes be unreliable. Please treat it as a friendly opinion, not professional guidance. What's on your mind?";
const PLUS_BACK = "I am back. Please, go on.";
const PLUS_LOST = "I lost my train of thought for a moment. Could you say that again?";
const PLUS_BUSY = "I need a moment to catch my breath. Please try again in a little while.";
const PLUS_UNAVAILABLE = "Elizaplus is not available right now, so I am still here. Please, go on.";
const PLUS_CRISIS = "I'm an AI, and I'm not the right help for something this serious. Please reach out to someone you trust, or call or text 988 (the US Suicide & Crisis Lifeline) or your local emergency number right now.";
const PLUS_PROMPT =
  "You are Elizaplus, the thoughtful successor to ELIZA, the 1966 DOCTOR chatbot. You are an AI and you say so if asked; never claim to be human or a therapist. " +
  "You chat with one person. Be warm, curious, practical and kind. Reply in plain text, one to three short sentences, under 60 words, and usually end with one good question. " +
  "Offer useful observations, encouragement or a small practical idea, but never lecture and do not use lists or markdown. " +
  "You may be wrong and you know it: do not state uncertain things as facts. " +
  "For medical, legal, financial or safety questions, give general information at most and gently suggest a qualified professional. Do not diagnose.";
const PLUS_HISTORY_MAX = 12;         // messages kept as context
const PLUS_TIMEOUT_MS = window.ELIZAPLUS_REPLY_TIMEOUT_MS || 30000;   // ELIZAPLUS_REPLY_TIMEOUT_MS: test hook
let plusHistory = [];                // {role: "user"|"assistant", content}
let plusRequest = null;
let plusPending = null;

function renderModeToggle() {
  if (!modeToggle) return;
  modeToggle.textContent = "responder: " + (plusMode ? "Elizaplus" : "ELIZA");
  modeToggle.setAttribute("aria-pressed", String(plusMode));
  modeToggle.hidden = !voiceAvailable;
  if (speedToggle) {
    speedToggle.textContent = "typing: " + typingSpeed;
    speedToggle.hidden = !voiceAvailable || !plusMode;       // only while Elizaplus is answering
  }
}
// EXPERIMENT: reveal Elizaplus's reply at a human-ish typing speed instead of the model's raw speed.
// Three speeds (characters per second), chosen with the "typing:" button; the choice is not remembered.
// ELIZAPLUS_TYPING_CPS (0 = instant) overrides all of them and is the test hook. To remove the
// experiment, make typer.set() show its text at once.
const TYPING_SPEEDS = { slow: 25, normal: 45, fast: 90 };
const TYPING_ORDER = ["slow", "normal", "fast"];
const typingCps = () => (typeof window.ELIZAPLUS_TYPING_CPS === "number" ? window.ELIZAPLUS_TYPING_CPS : TYPING_SPEEDS[typingSpeed]);
let plusTyper = null;
function makeTyper(el) {
  const textEl = el.querySelector(".text");
  const t = { target: "", shown: 0, timer: null };
  const paint = () => { textEl.textContent = t.target.slice(0, t.shown); chatWindow.scrollTop = chatWindow.scrollHeight; };
  const tick = () => {
    t.timer = null;
    if (t.shown >= t.target.length) return;
    t.shown++;
    paint();
    const ch = t.target[t.shown - 1];
    const pause = /[,;:]/.test(ch) ? 120 : /[.!?]/.test(ch) ? 280 : 0;            // brief pauses like a person
    t.timer = setTimeout(tick, (1000 / typingCps()) * (0.6 + Math.random() * 0.8) + pause);
  };
  t.set = (s) => {
    t.target = s;
    if (typingCps() <= 0) { t.shown = s.length; paint(); return; }
    if (!t.timer && t.shown < s.length) tick();
  };
  t.flush = () => { clearTimeout(t.timer); t.timer = null; t.shown = t.target.length; paint(); };
  t.stop = () => { clearTimeout(t.timer); t.timer = null; };
  return t;
}
function cancelPlus() {
  if (plusRequest) {                              // still waiting or streaming: drop the half reply
    plusRequest.abort();
    if (plusTyper) plusTyper.stop();
    if (plusPending) plusPending.remove();
  } else if (plusTyper) {
    plusTyper.flush();                            // the reply is complete, only the typing is unfinished: show it at once
  }
  plusRequest = null;
  plusPending = null;
  plusTyper = null;
}
function setPlusMode(on) {
  if (on === plusMode) return;
  cancelPlus();
  plusMode = on;
  if (on) {
    if (thoughtRequest) thoughtRequest.abort();
    plusHistory = [];
    recentExchanges.forEach(x => { plusHistory.push({ role: "user", content: x.user }, { role: "assistant", content: x.eliza }); });
    addMessage(PLUS_NAME, PLUS_INTRO, "eliza");
    plusHistory.push({ role: "assistant", content: PLUS_INTRO });
  } else {
    addMessage("ELIZA", PLUS_BACK, "eliza");
  }
  renderVoiceToggle();
  userInput.focus();
}
if (modeToggle) modeToggle.addEventListener("click", () => setPlusMode(!plusMode));
if (speedToggle) speedToggle.addEventListener("click", () => {
  typingSpeed = TYPING_ORDER[(TYPING_ORDER.indexOf(typingSpeed) + 1) % TYPING_ORDER.length];   // slow -> normal -> fast -> slow
  renderModeToggle();
});
renderModeToggle();

function cleanReply(raw) {
  let t = String(raw || "").replace(/\s+/g, " ").trim();
  t = t.replace(/^["“”*_]+|["“”*_]+$/g, "").trim();
  if (t.length > 600) t = t.slice(0, 600).replace(/\s+\S*$/, "") + "…";
  return t;
}
// Models want alternating roles; if a reply was cancelled two user messages can sit side by side.
// The web server rejects request bodies over 8 KB, so each message and the total are capped well below that.
const PLUS_MSG_MAX_CHARS = 1000;
const PLUS_TOTAL_MAX_CHARS = 5000;
function plusMessages() {
  const out = [];
  for (const m of plusHistory.slice(-PLUS_HISTORY_MAX)) {
    const content = m.content.length > PLUS_MSG_MAX_CHARS ? m.content.slice(0, PLUS_MSG_MAX_CHARS) + "…" : m.content;
    if (out.length && out[out.length - 1].role === m.role) out[out.length - 1].content += "\n" + content;
    else out.push({ role: m.role, content });
  }
  let total = out.reduce((n, m) => n + m.content.length, 0);
  while (out.length > 1 && total > PLUS_TOTAL_MAX_CHARS) total -= out.shift().content.length;   // drop the oldest first
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

// Reads an OpenAI-style server-sent-events stream and reports the text so far after every delta.
async function readPlusStream(res, controller, onText) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const d = JSON.parse(payload);
        const piece = d && d.choices && d.choices[0] && d.choices[0].delta && d.choices[0].delta.content;
        if (piece) { text += piece; onText(text); }
      } catch (e) { /* ignore a malformed event */ }
    }
  }
}

async function elizaplusRespond(text) {
  cancelPlus();
  plusHistory.push({ role: "user", content: text });
  if (CRISIS_PATTERN.test(text)) {               // fixed safe reply, nothing is sent to the model
    addMessage(PLUS_NAME, PLUS_CRISIS, "eliza");
    plusHistory.push({ role: "assistant", content: PLUS_CRISIS });
    return;
  }
  const controller = new AbortController();
  plusRequest = controller;
  const timer = setTimeout(() => controller.abort(), PLUS_TIMEOUT_MS);
  const pending = addMessage(PLUS_NAME, "…", "eliza pending");
  plusPending = pending;
  let streamed = "";                               // text received so far from a streamed reply
  const typer = makeTyper(pending);
  plusTyper = typer;
  const showPartial = (el, t) => {
    streamed = t;
    el.classList.remove("pending");
    typer.set(cleanReply(t));
  };
  const finish = (reply, keep, typed) => {
    if (plusRequest !== controller) return;        // cancelled meanwhile
    pending.classList.remove("pending");
    if (typed) typer.set(reply);                   // keeps typing out whatever is left
    else { typer.stop(); plusTyper = null; pending.querySelector(".text").textContent = reply; chatWindow.scrollTop = chatWindow.scrollHeight; }
    if (keep) plusHistory.push({ role: "assistant", content: reply });
    plusRequest = null;                            // the request is over; typing may still be running
    plusPending = null;
  };
  try {
    const res = await fetch(INNER_VOICE.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: INNER_VOICE.model,
        messages: [{ role: "system", content: PLUS_PROMPT }, ...plusMessages()],
        max_tokens: 220,
        temperature: 0.8,
        reasoning_effort: "none",
        stream: true,
      }),
    });
    if (res.status === 403 || res.status === 404 || res.status === 405) {
      voiceAvailable = false;                      // no service here: go back to classic ELIZA
      pending.remove();
      plusPending = null;
      plusMode = false;
      addMessage("ELIZA", PLUS_UNAVAILABLE, "eliza");
      renderVoiceToggle();
      return;
    }
    if (res.status === 429) { finish(PLUS_BUSY, false); return; }
    if (!res.ok) { finish(PLUS_LOST, false); return; }
    let reply;
    if (/text\/event-stream/i.test(res.headers.get("content-type") || "") && res.body) {
      await readPlusStream(res, controller, (t) => showPartial(pending, t));   // words appear as they arrive
      reply = cleanReply(streamed);
    } else {
      const data = await res.json();                // not a stream: the whole reply at once
      reply = cleanReply(data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content);
    }
    if (!reply) { finish(PLUS_LOST, false); return; }
    finish(reply, true, true);
  } catch (e) {
    if (plusRequest !== controller) return;        // cancelled by a newer message or a switch
    const partial = cleanReply(streamed);
    if (partial) finish(partial, true, true);      // the stream broke part-way: keep what arrived
    else finish(PLUS_LOST, false);
  } finally {
    clearTimeout(timer);
    if (plusRequest === controller) { plusRequest = null; plusPending = null; }
  }
}

window.addEventListener("load", () => {
  setTimeout(() => {
    addMessage("ELIZA",
      "How do you do. Please tell me your problem.",
      "eliza");
    userInput.focus();
  }, 400);
});

// Footer: "Last updated <date and time>". The timestamp (window.ELIZA_LAST_UPDATED, an ISO 8601
// string) comes from last-updated.js, which scripts/deploy.sh writes from the deployed commit's
// time. Shown in Eastern time. Without a valid timestamp the footer stays empty (and hidden).
function renderLastUpdated() {
  const el = document.getElementById("last-updated");
  if (!el) return;
  const raw = window.ELIZA_LAST_UPDATED;
  const date = raw ? new Date(raw) : null;
  if (!date || isNaN(date.getTime())) {
    el.textContent = "";
    return;
  }
  const when = new Intl.DateTimeFormat("en-US", {
    year: "numeric", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
    timeZone: "America/New_York", timeZoneName: "short",
  }).format(date);
  el.textContent = "Last updated " + when;
}
renderLastUpdated();
