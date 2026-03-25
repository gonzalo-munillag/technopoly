const socket = io();

let myRole = null;
let myPlayerId = null;
let myName = null;
let isEditor = false;
let lastGameState = null;
let lastPrivateState = null;

// ── DOM refs ────────────────────────────────────────────────
const loginScreen  = document.getElementById("login-screen");
const lobbyScreen  = document.getElementById("lobby-screen");
const gameScreen   = document.getElementById("game-screen");

const playerNameIn = document.getElementById("player-name");
const passwordIn   = document.getElementById("password");
const loginBtn     = document.getElementById("login-btn");
const loginError   = document.getElementById("login-error");

const playerList   = document.getElementById("player-list");
const startGameBtn = document.getElementById("start-game-btn");
const lobbyError   = document.getElementById("lobby-error");

const yearBadge    = document.getElementById("year-badge");
const phaseBadge   = document.getElementById("phase-badge");
const turnBadge    = document.getElementById("turn-badge");
const dealerBadge  = document.getElementById("dealer-badge");
const resourcesDiv = document.getElementById("resources-panel");
const productionDiv = document.getElementById("production-panel");
const playedDiv    = document.getElementById("played-cards");
const companyPanel = document.getElementById("company-panel");
const gameError    = document.getElementById("game-error");

const companyPickArea   = document.getElementById("company-pick-area");
const companyCardsDiv   = document.getElementById("company-cards-container");
const companyWaiting    = document.getElementById("company-waiting");
const draftArea         = document.getElementById("draft-area");
const draftContainer    = document.getElementById("draft-container");
const draftYear         = document.getElementById("draft-year");
const doneDraftBtn      = document.getElementById("done-draft-btn");
const hiringArea        = document.getElementById("hiring-area");
const regulationArea    = document.getElementById("regulation-area");
const regulationDisplay = document.getElementById("regulation-card-display");
const regulationAlertBox = document.getElementById("regulation-alert-box");
const regulationActions = document.getElementById("regulation-actions");
const regAcceptBtn      = document.getElementById("reg-accept-btn");
const regCourtBtn       = document.getElementById("reg-court-btn");
const regulationResultBox = document.getElementById("regulation-result-box");
const regulationWaiting = document.getElementById("regulation-waiting");
const regProceedBtn     = document.getElementById("reg-proceed-btn");
const regStartYearBtn  = document.getElementById("reg-start-year-btn");
const turnsArea         = document.getElementById("turns-area");
const fuckupAlert       = document.getElementById("fuckup-alert");
const yearDoneWaiting   = document.getElementById("year-done-waiting");
const turnsContent      = document.getElementById("turns-content");
const handDiv           = document.getElementById("hand-container");
const endTurnBtn        = document.getElementById("end-turn-btn");
const endYearBtn        = document.getElementById("end-year-btn");
const cardsPlayedInfo   = document.getElementById("cards-played-info");
const endGameBtn        = document.getElementById("end-game-btn");
const restartGameBtn    = document.getElementById("restart-game-btn");
const showHandBtn       = document.getElementById("show-hand-btn");
const handModal         = document.getElementById("hand-modal");
const closeHandModal    = document.getElementById("close-hand-modal");
const handModalBody     = document.getElementById("hand-modal-body");
const editCardsBtn      = document.getElementById("edit-cards-btn");
const editorModal       = document.getElementById("editor-modal");
const editorTitle       = document.getElementById("editor-title");
const closeEditorModal  = document.getElementById("close-editor-modal");
const editorBody        = document.getElementById("editor-body");

const PHASE_LABELS = {
  company_pick: "Company Pick",
  year_start_draft: "Draft",
  hiring: "Hiring",
  regulation: "Regulation",
  player_turns: "Turns",
  year_end: "Year End",
};

const CARD_TYPE_GROUPS = [
  { key: "company", label: "Company" },
  { key: "platform", label: "Platform" },
  { key: "cyber_attack", label: "Cyber Attacks" },
  { key: "innovation", label: "Innovation" },
  { key: "leverage", label: "Leverage" },
  { key: "fuck_up", label: "Fuck-ups" },
  { key: "build", label: "Build" },
  { key: "regulation", label: "Regulation" },
];

const DRAFT_SECTIONS = [
  { deck: "projects", label: "Projects", types: ["platform", "cyber_attack"] },
  { deck: "boosters", label: "Boosters", types: ["leverage", "innovation", "build"] },
];

// ── In-game confirm dialog ──────────────────────────────────
function showConfirmDialog(message, onConfirm, opts = {}) {
  const existing = document.querySelector(".confirm-dialog-overlay");
  if (existing) existing.remove();

  const dismiss = () => {
    overlay.remove();
    if (opts.onDismiss) opts.onDismiss();
  };

  const overlay = document.createElement("div");
  overlay.className = opts.parent ? "confirm-dialog-overlay confirm-dialog-inline" : "confirm-dialog-overlay";

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) dismiss();
  });

  const box = document.createElement("div");
  box.className = "confirm-dialog";

  const msg = document.createElement("p");
  msg.className = "confirm-dialog-msg";
  msg.textContent = message;
  box.appendChild(msg);

  if (opts.detail) {
    const det = document.createElement("p");
    det.className = "confirm-dialog-detail";
    det.textContent = opts.detail;
    box.appendChild(det);
  }

  const actions = document.createElement("div");
  actions.className = "confirm-dialog-actions";

  const yesBtn = document.createElement("button");
  yesBtn.className = "btn btn-sm btn-accent";
  yesBtn.textContent = opts.confirmText || "Confirm";
  yesBtn.addEventListener("click", () => { overlay.remove(); onConfirm(); });

  const noBtn = document.createElement("button");
  noBtn.className = "btn btn-sm";
  noBtn.textContent = opts.cancelText || "Cancel";
  noBtn.addEventListener("click", () => dismiss());

  actions.appendChild(yesBtn);
  actions.appendChild(noBtn);
  box.appendChild(actions);
  overlay.appendChild(box);
  (opts.parent || document.body).appendChild(overlay);
  yesBtn.focus();
}

// ── Screen switching ────────────────────────────────────────
function showScreen(screen) {
  [loginScreen, lobbyScreen, gameScreen].forEach(s => s.classList.remove("active"));
  screen.classList.add("active");
}

function showPhaseArea(phase) {
  [companyPickArea, draftArea, hiringArea, regulationArea, turnsArea].forEach(a => a.classList.add("hidden"));
  const map = {
    company_pick: companyPickArea,
    year_start_draft: draftArea,
    hiring: hiringArea,
    regulation: regulationArea,
    player_turns: turnsArea,
  };
  if (map[phase]) map[phase].classList.remove("hidden");
}

// ── Login ───────────────────────────────────────────────────
let _savedCredentials = null;

loginBtn.addEventListener("click", () => {
  const name = playerNameIn.value.trim();
  const password = passwordIn.value;
  if (!name) { loginError.textContent = "Enter your name."; return; }
  _savedCredentials = { name, password };
  socket.emit("login", { name, password });
});

passwordIn.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loginBtn.click();
});

socket.on("connect", () => {
  if (_savedCredentials) {
    socket.emit("login", _savedCredentials);
  }
});

socket.on("login_success", (data) => {
  myRole = data.role;
  myPlayerId = data.player_id;
  myName = data.name;
  isEditor = !!data.is_editor;
  loginError.textContent = "";

  if (lastGameState && lastGameState.started) {
    _applyGameScreenUI();
  } else {
    showScreen(lobbyScreen);
  }
  if (myRole === "master") {
    startGameBtn.classList.remove("hidden");
  }
  if (isEditor) {
    document.getElementById("edit-cards-lobby-btn").classList.remove("hidden");
    document.getElementById("edit-board-lobby-btn").classList.remove("hidden");
    document.getElementById("edit-params-lobby-btn").classList.remove("hidden");
    document.getElementById("fetch-data-lobby-btn").classList.remove("hidden");
  }
});

socket.on("login_error", (data) => {
  loginError.textContent = data.message;
});

// ── Lobby ───────────────────────────────────────────────────
socket.on("lobby_update", (data) => {
  playerList.innerHTML = "";
  data.players.forEach(p => {
    const li = document.createElement("li");
    li.textContent = p.name + (p.player_id === myPlayerId ? " (you)" : "");
    playerList.appendChild(li);
  });
});

startGameBtn.addEventListener("click", () => socket.emit("start_game"));

socket.on("error", (data) => {
  if (lobbyScreen.classList.contains("active")) {
    lobbyError.textContent = data.message;
  } else {
    showFloatingError(data.message);
  }
});

// ── Game events ─────────────────────────────────────────────
function _applyGameScreenUI() {
  showScreen(gameScreen);
  if (myRole === "master") {
    restartGameBtn.classList.remove("hidden");
    endGameBtn.classList.remove("hidden");
  }
  if (isEditor) {
    editCardsBtn.classList.remove("hidden");
    document.getElementById("edit-board-btn").classList.remove("hidden");
    document.getElementById("edit-params-btn").classList.remove("hidden");
    document.getElementById("fetch-data-btn").classList.remove("hidden");
  }
}

socket.on("game_started", (state) => {
  _applyGameScreenUI();
  renderGameState(state);
});

socket.on("game_state", (state) => {
  if (state.started) _applyGameScreenUI();
  renderGameState(state);
  renderUsersPie();
});

socket.on("your_state", (data) => {
  const hadPending = lastPrivateState?.pending_tile;
  lastPrivateState = data;
  renderResources(data.resources);
  renderProduction(data.production);
  renderUsersPie();
  renderHand(data.hand);
  renderDraft(data.draft_pool, data.drafted_fuckups);
  cardsPlayedInfo.textContent = `(${data.cards_played_this_turn}/2 played)`;

  if (lastGameState?.phase === "company_pick" && data.company_offers?.length) {
    const me = lastGameState.players[myPlayerId];
    if (!me || !me.company) {
      renderCompanyCards(data.company_offers);
    }
  }

  updateTurnsUI();
  updateRegulationUI();

  if (lastGameState?.phase === "hiring") {
    renderHiringPhase();
  }

  if (!hadPending && data.pending_tile) {
    socket.emit("get_board");
  }

  if (hadPending && !data.pending_tile && !boardModal.classList.contains("hidden")) {
    renderBoard();
  }
});

function updateTurnsUI() {
  if (!lastGameState || !lastPrivateState) return;
  if (lastGameState.phase !== "player_turns") return;

  if (lastPrivateState.year_done) {
    yearDoneWaiting.classList.remove("hidden");
    turnsContent.classList.add("hidden");
    fuckupAlert.classList.add("hidden");
  } else {
    yearDoneWaiting.classList.add("hidden");
    turnsContent.classList.remove("hidden");

    if (lastPrivateState.has_fuckups) {
      const names = lastPrivateState.hand.filter(c => c.card_type === "fuck_up").map(c => c.name);
      const isMyTurn = lastGameState.current_player_id === myPlayerId;
      fuckupAlert.innerHTML = isMyTurn
        ? `<strong>Fuck-up cards are the ONLY thing you can play this turn:</strong> ${names.join(", ")}`
        : `<strong>You have fuck-up cards that must be played on your turn:</strong> ${names.join(", ")}`;
      fuckupAlert.classList.remove("hidden");
    } else {
      fuckupAlert.classList.add("hidden");
    }
  }
}

function updateRegulationUI() {
  if (!lastGameState || !lastPrivateState) return;
  if (lastGameState.phase !== "regulation") return;

  if (lastPrivateState.regulation_resolved) {
    regulationActions.classList.add("hidden");
    regProceedBtn.classList.add("hidden");
    const allResolved = Object.values(lastGameState.players).every(p => p.regulation_resolved);
    if (allResolved) {
      regulationWaiting.classList.add("hidden");
      regStartYearBtn.classList.remove("hidden");
    } else {
      regulationWaiting.textContent = "Waiting for others to resolve their compliance...";
      regulationWaiting.classList.remove("hidden");
      regStartYearBtn.classList.add("hidden");
    }
  } else {
    regulationWaiting.classList.add("hidden");
    regStartYearBtn.classList.add("hidden");
    if (lastPrivateState.regulation_affected) {
      regulationActions.classList.remove("hidden");
      regProceedBtn.classList.add("hidden");
    } else {
      regulationActions.classList.add("hidden");
      regProceedBtn.classList.remove("hidden");
    }
  }
}

socket.on("game_ended", () => {
  showScreen(loginScreen);
  myRole = null;
  myPlayerId = null;
  myName = null;
  lastGameState = null;
  lastPrivateState = null;
});

function getRepMod(rep) {
  const thresh = lastGameState?.params?.reputation_thresholds || [
    { min_rep: 10, modifier: 2 }, { min_rep: 5, modifier: 1 },
    { max_rep: -10, modifier: -2 }, { max_rep: -5, modifier: -1 },
  ];
  for (const t of thresh) {
    if ("min_rep" in t && rep >= t.min_rep) return t.modifier;
    if ("max_rep" in t && rep <= t.max_rep) return t.modifier;
  }
  return 0;
}

// ── Render game state ───────────────────────────────────────
function renderGameState(state) {
  lastGameState = state;
  rebuildCardIndex();
  yearBadge.textContent = `Year ${state.year}`;
  phaseBadge.textContent = PHASE_LABELS[state.phase] || state.phase;

  if (state.params) {
    const p = state.params;
    const bs = document.getElementById("buy-server-btn");
    const ba = document.getElementById("buy-ad-btn");
    if (bs) bs.setAttribute("data-tip", `${p.buy_server_engineers ?? 1}🔧 + 💰$${p.buy_server_money ?? 1}M`);
    if (ba) ba.setAttribute("data-tip", `${p.buy_ad_suits ?? 1}👔 + 💰$${p.buy_ad_money ?? 1}M`);
  }
  showPhaseArea(state.phase);

  if (state.start_player_id) {
    const startPlayer = state.players[state.start_player_id];
    const isMe = state.start_player_id === myPlayerId;
    const name = isMe ? "You" : startPlayer?.name || "?";
    dealerBadge.textContent = `${name} start${isMe ? "" : "s"} the year`;
  }

  if (state.phase === "player_turns" && state.current_player_id) {
    const me = state.players[myPlayerId];
    if (me && me.year_done) {
      turnBadge.classList.add("hidden");
    } else {
      const currentPlayer = state.players[state.current_player_id];
      const isMyTurn = state.current_player_id === myPlayerId;
      turnBadge.textContent = isMyTurn ? "Your Turn!" : `Turn: ${currentPlayer?.name || "..."}`;
      turnBadge.style.background = isMyTurn ? "var(--accent)" : "var(--primary)";
      turnBadge.classList.remove("hidden");
      endTurnBtn.disabled = !isMyTurn;
      endYearBtn.disabled = !isMyTurn;
    }
  } else {
    turnBadge.classList.add("hidden");
  }

  if (state.phase === "company_pick") {
    const me = state.players[myPlayerId];
    if (me && me.company) {
      companyCardsDiv.innerHTML = "";
      companyWaiting.classList.remove("hidden");
    } else {
      companyWaiting.classList.add("hidden");
      if (lastPrivateState?.company_offers) {
        renderCompanyCards(lastPrivateState.company_offers);
      }
    }
  }

  if (state.phase === "hiring") {
    renderHiringPhase();
  }

  if (state.phase === "regulation") {
    renderRegulation(state.current_regulation);
  }

  updateTurnsUI();
  updateRegulationUI();

  draftYear.textContent = state.year;

  renderPlayersCards(state);

  const me = state.players[myPlayerId];
  if (me) {
    renderPlayedCards(me.played_cards);

    if (me.company) {
      companyPanel.innerHTML = `<div class="company-name">${me.company.name}</div>
        <div class="company-desc">${me.company.description || ""}</div>`;
    } else {
      companyPanel.innerHTML = `<span class="text-dim">None yet</span>`;
    }
  }
}

// ── Company pick ────────────────────────────────────────────
function renderCompanyCards(cards) {
  companyCardsDiv.innerHTML = "";
  cards.forEach(card => {
    const el = createCardElement(card);
    el.addEventListener("click", () => {
      socket.emit("pick_company", { card_name: card.name });
    });
    companyCardsDiv.appendChild(el);
  });
}

// ── Draft ───────────────────────────────────────────────────
function renderDraft(pool, draftedFuckups) {
  draftContainer.innerHTML = "";

  if (lastPrivateState?.ready && lastGameState?.phase === "year_start_draft") {
    const waitDiv = document.createElement("div");
    waitDiv.className = "waiting-msg";
    waitDiv.textContent = "You finished drafting. Waiting for other players...";
    draftContainer.appendChild(waitDiv);
    doneDraftBtn.classList.add("hidden");
    return;
  }

  if ((!pool || pool.length === 0) && (!draftedFuckups || draftedFuckups.length === 0)) {
    doneDraftBtn.classList.add("hidden");
    return;
  }

  doneDraftBtn.classList.remove("hidden");

  const hintEl = document.querySelector(".phase-hint");
  if (hintEl) {
    const pd = lastGameState?.params?.projects_draw ?? 3;
    const bd = lastGameState?.params?.boosters_draw ?? 3;
    const dc = lastGameState?.params?.draft_cost ?? 3;
    hintEl.textContent = `You drew ${pd} Projects + ${bd} Boosters. Pay ${dc} money to keep each card. Fuck-up cards are free and go straight to your hand.`;
  }

  const draftRow = document.createElement("div");
  draftRow.className = "draft-grid";

  DRAFT_SECTIONS.forEach(section => {
    const matching = pool.filter(c => section.types.includes(c.card_type));
    if (matching.length === 0) return;

    const sectionDiv = document.createElement("div");
    sectionDiv.className = "draft-section";
    const h3 = document.createElement("h3");
    h3.className = "draft-section-title";
    h3.textContent = section.label;
    sectionDiv.appendChild(h3);

    const grid = document.createElement("div");
    grid.className = "hand-container";
    matching.forEach(card => {
      const el = createCardElement(card);
      const keepBtn = document.createElement("button");
      keepBtn.className = "btn btn-sm btn-keep";
      const draftCost = lastGameState?.params?.draft_cost ?? 3;
      keepBtn.textContent = `Keep (${draftCost} money)`;
      keepBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        socket.emit("keep_card", { card_name: card.name });
      });
      el.appendChild(keepBtn);
      grid.appendChild(el);
    });
    sectionDiv.appendChild(grid);
    draftRow.appendChild(sectionDiv);
  });
  draftContainer.appendChild(draftRow);

  if (draftedFuckups && draftedFuckups.length > 0) {
    const sep = document.createElement("hr");
    sep.className = "draft-fuckup-separator";
    draftContainer.appendChild(sep);

    const sectionDiv = document.createElement("div");
    sectionDiv.className = "draft-section draft-fuckup-section";
    const h3 = document.createElement("h3");
    h3.className = "draft-section-title";
    h3.textContent = "Fuck-ups (added to your hand)";
    sectionDiv.appendChild(h3);

    const grid = document.createElement("div");
    grid.className = "hand-container";
    draftedFuckups.forEach(card => {
      const el = createCardElement(card);
      el.classList.add("fuckup-card");
      const badge = document.createElement("div");
      badge.className = "draft-fuckup-badge";
      badge.textContent = "Added to your hand";
      el.appendChild(badge);
      grid.appendChild(el);
    });
    sectionDiv.appendChild(grid);
    draftContainer.appendChild(sectionDiv);
  }
}

doneDraftBtn.addEventListener("click", () => socket.emit("done_drafting"));

// ── Hiring Phase ────────────────────────────────────────────
function renderHiringPhase() {
  const hiringPrompt = document.getElementById("hiring-prompt");
  const hiringForm = document.getElementById("hiring-form");
  const hiringWaiting = document.getElementById("hiring-waiting");
  const hireEng = document.getElementById("hire-engineers");
  const hireSuit = document.getElementById("hire-suits");
  const hiringTotal = document.getElementById("hiring-total");

  if (!lastPrivateState || !lastGameState) return;

  const me = lastGameState.players?.[myPlayerId];
  if (!me) return;

  if (me.hiring_done) {
    hiringForm.classList.add("hidden");
    hiringWaiting.classList.remove("hidden");
    return;
  }
  hiringForm.classList.remove("hidden");
  hiringWaiting.classList.add("hidden");

  const hr = lastPrivateState.production?.HR || 0;
  const rep = lastPrivateState.resources?.reputation || 0;
  const repMod = getRepMod(rep);
  const effective = hr >= 0 ? Math.max(0, hr + repMod) : hr;
  if (hr >= 0) {
    const modStr = repMod ? ` (HR ${hr} + rep ${repMod > 0 ? "+" : ""}${repMod})` : "";
    hiringPrompt.textContent = `You can hire ${effective} employee(s)${modStr}. Distribute between engineers and suits.`;
  } else {
    hiringPrompt.textContent = `You must fire ${Math.abs(effective)} employee(s). Choose how many engineers and suits to let go.`;
  }

  const updateTotal = () => {
    const e = parseInt(hireEng.value) || 0;
    const s = parseInt(hireSuit.value) || 0;
    const target = Math.abs(effective);
    hiringTotal.textContent = `Total: ${e + s} / ${target}`;
    hiringTotal.style.color = (e + s === target) ? "var(--accent)" : "var(--danger)";
  };
  hireEng.onchange = updateTotal;
  hireSuit.onchange = updateTotal;
  hireEng.oninput = updateTotal;
  hireSuit.oninput = updateTotal;
  hireEng.value = 0;
  hireSuit.value = 0;
  updateTotal();
}

document.querySelectorAll(".hire-arrow").forEach(btn => {
  btn.addEventListener("click", () => {
    const input = document.getElementById(btn.dataset.target);
    if (!input) return;
    let val = parseInt(input.value) || 0;
    if (btn.classList.contains("hire-inc")) val++;
    else val = Math.max(0, val - 1);
    input.value = val;
    input.dispatchEvent(new Event("input"));
  });
});

// ── Universal number spinner ──────────────────────────────────
// Wraps any <input type="number"> with ▲/▼ buttons in-place.
// opts.min defaults to -Infinity (no floor); opts.step defaults to 1.
function makeNumSpinner(input, opts = {}) {
  const min = opts.min ?? -Infinity;
  const step = opts.step ?? 1;

  const wrap = document.createElement("div");
  wrap.className = "num-spinner";

  const dec = document.createElement("button");
  dec.type = "button";
  dec.className = "spin-arrow spin-dec";
  dec.textContent = "▼";
  dec.addEventListener("click", () => {
    const nv = (parseFloat(input.value) || 0) - step;
    if (nv >= min) {
      input.value = nv;
      input.dispatchEvent(new Event("input"));
      input.dispatchEvent(new Event("change"));
    }
  });

  const inc = document.createElement("button");
  inc.type = "button";
  inc.className = "spin-arrow spin-inc";
  inc.textContent = "▲";
  inc.addEventListener("click", () => {
    input.value = (parseFloat(input.value) || 0) + step;
    input.dispatchEvent(new Event("input"));
    input.dispatchEvent(new Event("change"));
  });

  if (input.parentNode) {
    input.parentNode.insertBefore(wrap, input);
  }
  wrap.appendChild(dec);
  wrap.appendChild(input);
  wrap.appendChild(inc);
  return wrap;
}

document.getElementById("conclude-hiring-btn").addEventListener("click", () => {
  const eng = parseInt(document.getElementById("hire-engineers").value) || 0;
  const suits = parseInt(document.getElementById("hire-suits").value) || 0;
  socket.emit("submit_hiring", { engineers: eng, suits });
});

// ── Regulation ──────────────────────────────────────────────
function renderRegulation(card) {
  if (!card) {
    regulationDisplay.innerHTML = `<p class="text-dim">No regulation card this year.</p>`;
    return;
  }
  regulationDisplay.innerHTML = "";
  const el = createCardElement(card);
  const compText = Object.entries(card.compliance || card.penalty || {})
    .map(([k, v]) => `${v > 0 ? "+" : ""}${v} ${emojiRes(k)}`)
    .join(", ");
  const courtText = Object.entries(card.court_penalty || {})
    .map(([k, v]) => `${v > 0 ? "+" : ""}${v} ${emojiRes(k)}`)
    .join(", ");
  const threshold = card.court_threshold || 4;
  const winPct = Math.round(((7 - threshold) / 6) * 100);
  const losePct = 100 - winPct;
  let infoHtml = "";
  if (compText) infoHtml += `<p class="reg-compliance-text"><strong>Compliance:</strong> ${compText}</p>`;
  if (courtText) infoHtml += `<p class="reg-court-text"><strong>Court penalty:</strong> ${courtText}</p>`;
  infoHtml += `<p class="reg-court-text"><strong>Court odds:</strong> ${winPct}% win / ${losePct}% lose (>= ${threshold} on a die roll to win)</p>`;
  if (infoHtml) {
    const infoDiv = document.createElement("div");
    infoDiv.className = "regulation-penalty-info";
    infoDiv.innerHTML = infoHtml;
    el.appendChild(infoDiv);
  }
  regulationDisplay.appendChild(el);
}

socket.on("regulation_alert", (data) => {
  if (data.affected) {
    const compText = Object.entries(data.compliance)
      .map(([k, v]) => `${v > 0 ? "+" : ""}${v} ${emojiRes(k)}`).join(", ");
    const courtText = Object.entries(data.court_penalty)
      .map(([k, v]) => `${v > 0 ? "+" : ""}${v} ${emojiRes(k)}`).join(", ");
    const winPct = Math.round(((7 - data.court_threshold) / 6) * 100);
    const losePct = 100 - winPct;
    const targeted = (data.targeted_cards || []).map(c => c.name).join(", ");
    let html = `<p><strong>This regulation affects you!</strong></p>`;
    if (targeted) html += `<p>Targeted card(s): <strong>${targeted}</strong> — accepting means losing them.</p>`;
    html += `<p class="reg-compliance-text">Accept compliance: ${compText}</p>`;
    html += `<p class="reg-court-text">Court loss penalty: ${courtText} — ${losePct}% chance of losing (>= ${data.court_threshold} on a die roll to win)</p>`;
    if (targeted) html += `<p class="reg-compliance-text">Win in court (${winPct}%): keep your card(s), no penalty.</p>`;
    regulationAlertBox.innerHTML = html;
    regulationAlertBox.classList.remove("hidden");
    regulationActions.classList.remove("hidden");
    regulationResultBox.classList.add("hidden");
    regulationWaiting.classList.add("hidden");
    regProceedBtn.classList.add("hidden");
  } else {
    const nobodyAffected = !data.any_affected;
    regulationAlertBox.innerHTML = nobodyAffected
      ? `<p>No players are affected by this regulation.</p>`
      : `<p>This regulation does not affect you.</p>`;
    regulationAlertBox.classList.remove("hidden");
    regulationActions.classList.add("hidden");
    regulationResultBox.classList.add("hidden");
    regulationWaiting.classList.add("hidden");
    regProceedBtn.classList.remove("hidden");
  }
});

regAcceptBtn.addEventListener("click", () => socket.emit("regulation_accept"));
regCourtBtn.addEventListener("click", () => socket.emit("regulation_court"));
regProceedBtn.addEventListener("click", () => {
  socket.emit("proceed_regulation");
  regProceedBtn.classList.add("hidden");
  regulationWaiting.textContent = "Waiting for others to resolve their compliance...";
  regulationWaiting.classList.remove("hidden");
});

socket.on("regulation_result", (data) => {
  regulationActions.classList.add("hidden");
  regulationResultBox.classList.remove("hidden");
  const lostCards = (data.lost_cards || []);
  const lostMsg = lostCards.length ? `<p>Lost card(s): <strong>${lostCards.join(", ")}</strong></p>` : "";
  if (data.action === "accept") {
    const compText = Object.entries(data.compliance || data.penalty || {})
      .map(([k, v]) => `${v > 0 ? "+" : ""}${v} ${emojiRes(k)}`).join(", ");
    regulationResultBox.innerHTML = `<p>You accepted the compliance: ${compText}</p>${lostMsg}`;
  } else {
    const result = data.won ? "Won" : "Lost";
    let msg = `<p>Court roll: <strong>${data.roll}</strong> (needed ${data.threshold}+) — <strong>${result}!</strong></p>`;
    if (!data.won) {
      const courtText = Object.entries(data.penalty || {})
        .map(([k, v]) => `${v > 0 ? "+" : ""}${v} ${emojiRes(k)}`).join(", ");
      msg += `<p>Court penalty applied: ${courtText}</p>${lostMsg}`;
    } else {
      msg += `<p>No penalty — you beat the case and keep your cards!</p>`;
    }
    regulationResultBox.innerHTML = msg;
  }
  regProceedBtn.classList.add("hidden");
  regStartYearBtn.classList.add("hidden");
  regulationWaiting.textContent = "Waiting for others to resolve their compliance...";
  regulationWaiting.classList.remove("hidden");
});

socket.on("regulation_all_resolved", () => {
  regulationWaiting.classList.add("hidden");
  regStartYearBtn.classList.remove("hidden");
});

regStartYearBtn.addEventListener("click", () => {
  socket.emit("start_year_after_regulation");
  regStartYearBtn.classList.add("hidden");
});

// ── Hand (player turns) ────────────────────────────────────
function findPayeesForFee(feeCardId) {
  if (!feeCardId || !lastGameState) return [];
  const results = [];
  for (const [pid, p] of Object.entries(lastGameState.players)) {
    if (pid === myPlayerId) continue;
    const has = (p.played_cards || []).some(c => c.id === feeCardId);
    if (has) results.push({ pid, name: p.name });
  }
  return results;
}

function iOwnFeeCard(feeCardId) {
  if (!feeCardId || !lastGameState) return false;
  const me = lastGameState.players[myPlayerId];
  return (me?.played_cards || []).some(c => c.id === feeCardId);
}

function showPaymentPopup(card, useOptional, callback) {
  const cardCosts = card.costs || {};
  const hasFee = cardCosts.fee && cardCosts.fee_card_id;

  // No fee needed: player owns the fee card, or nobody else has played it
  if (hasFee && iOwnFeeCard(cardCosts.fee_card_id)) {
    callback({});
    return;
  }

  const feePayees = hasFee ? findPayeesForFee(cardCosts.fee_card_id) : [];

  // No payees at all — play for free (no one to pay)
  if (!feePayees.length) { callback({}); return; }

  const overlay = document.createElement("div");
  overlay.className = "payment-popup-overlay";
  const popup = document.createElement("div");
  popup.className = "payment-popup";

  let payTo = {};

  if (feePayees.length === 1) {
    // Auto-select the single payee — just confirm
    const { pid, name } = feePayees[0];
    payTo = { fee: pid };
    popup.innerHTML = `<h3>Fee payment</h3>
      <p class="payment-info">You must pay <strong>💰$${cardCosts.fee}M</strong> to <strong>${name}</strong><br>
      (they have played <em>${cardNameById(cardCosts.fee_card_id)}</em>).</p>`;
  } else {
    // Multiple payees — show dropdown
    popup.innerHTML = `<h3>Choose who to pay the fee</h3>`;
    const row = document.createElement("div");
    row.className = "payment-row";
    row.innerHTML = `<span class="payment-label">Fee (💰$${cardCosts.fee}M) → ${cardNameById(cardCosts.fee_card_id)}:</span>`;
    const sel = document.createElement("select");
    sel.className = "payment-select";
    feePayees.forEach(({ pid, name }) => {
      const o = document.createElement("option");
      o.value = pid; o.textContent = name;
      sel.appendChild(o);
    });
    row.appendChild(sel);
    popup.appendChild(row);

    // Override payTo on confirm
    const origConfirm = () => { if (sel.value) payTo = { fee: sel.value }; };
    sel.addEventListener("change", origConfirm);
    payTo = { fee: feePayees[0].pid }; // default first
    sel.addEventListener("change", () => { payTo = { fee: sel.value }; });
  }

  const actions = document.createElement("div");
  actions.className = "payment-actions";
  const confirmBtn = document.createElement("button");
  confirmBtn.className = "btn btn-sm btn-accent";
  confirmBtn.textContent = "Confirm & Play";
  confirmBtn.addEventListener("click", () => {
    overlay.remove();
    callback(payTo);
  });
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn btn-sm";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => overlay.remove());
  actions.appendChild(confirmBtn);
  actions.appendChild(cancelBtn);
  popup.appendChild(actions);

  overlay.appendChild(popup);
  document.body.appendChild(overlay);
}

function renderHand(hand) {
  handDiv.innerHTML = "";
  hand.forEach(card => {
    const el = createCardElement(card, { interactive: true });
    const costs = card.costs || {};
    const hasFee = costs.fee && costs.fee_card_id;

    el.addEventListener("click", () => {
      if (hasFee) {
        showPaymentPopup(card, {}, (payTo) => {
          socket.emit("play_card", { card_name: card.name, use_optional: {}, pay_to: payTo });
        });
      } else {
        socket.emit("play_card", { card_name: card.name, use_optional: {} });
      }
    });
    // Show fee status hint on the card itself
    if (hasFee) {
      const feeCardId = costs.fee_card_id;
      const owns = iOwnFeeCard(feeCardId);
      const payees = findPayeesForFee(feeCardId);
      const badge = document.createElement("div");
      badge.className = "card-fee-status";
      if (owns) {
        badge.textContent = "💸 Fee waived (you own it)";
        badge.classList.add("fee-waived");
      } else if (payees.length === 0) {
        badge.textContent = "💸 Fee: no one to pay";
        badge.classList.add("fee-free");
      } else if (payees.length === 1) {
        badge.textContent = `💸 Fee → ${payees[0].name}`;
        badge.classList.add("fee-due");
      } else {
        badge.textContent = `💸 Fee → choose player`;
        badge.classList.add("fee-due");
      }
      el.appendChild(badge);
    }
    handDiv.appendChild(el);
  });
}

// ── Played cards with hover tooltip ─────────────────────────
const floatingTooltip = document.createElement("div");
floatingTooltip.className = "floating-card-tooltip hidden";
document.body.appendChild(floatingTooltip);

function renderPlayedCards(cards) {
  playedDiv.innerHTML = "";
  if (!cards || cards.length === 0) {
    const empty = document.createElement("div");
    empty.className = "text-dim";
    empty.textContent = "None yet";
    playedDiv.appendChild(empty);
    return;
  }
  cards.forEach(c => {
    const div = document.createElement("div");
    div.className = "played-mini";

    const nameSpan = document.createElement("span");
    nameSpan.textContent = c.name;
    div.appendChild(nameSpan);

    const tagSpan = document.createElement("span");
    tagSpan.className = "played-mini-tag";
    tagSpan.textContent = c.tag || c.card_type;
    div.appendChild(tagSpan);

    div.addEventListener("mouseenter", (e) => {
      floatingTooltip.innerHTML = "";
      floatingTooltip.appendChild(createCardElement(c));
      floatingTooltip.classList.remove("hidden");
      const rect = div.getBoundingClientRect();
      const ttW = 260;
      const ttH = floatingTooltip.offsetHeight || 350;
      let left = rect.right + 8;
      let top = rect.top;
      if (left + ttW > window.innerWidth) left = rect.left - ttW - 8;
      if (top + ttH > window.innerHeight) top = Math.max(4, window.innerHeight - ttH - 4);
      if (top < 4) top = 4;
      floatingTooltip.style.top = top + "px";
      floatingTooltip.style.left = left + "px";
    });

    div.addEventListener("mouseleave", () => {
      floatingTooltip.classList.add("hidden");
    });

    playedDiv.appendChild(div);
  });
}

// ── Players' Cards (other players' played cards) ────────────
const playersCardsListDiv = document.getElementById("players-cards-list");
const playerCardsModal = document.getElementById("player-cards-modal");
const playerCardsModalTitle = document.getElementById("player-cards-modal-title");
const playerCardsModalBody = document.getElementById("player-cards-modal-body");

document.getElementById("close-player-cards-modal").addEventListener("click", () => playerCardsModal.classList.add("hidden"));
playerCardsModal.addEventListener("click", (e) => { if (e.target === playerCardsModal) playerCardsModal.classList.add("hidden"); });

function openPlayerCardsModal(pid) {
  const state = lastGameState;
  if (!state || !state.players || !state.players[pid]) return;
  const p = state.players[pid];
  const played = p.played_cards || [];

  playerCardsModalTitle.textContent = `${p.name}'s Cards`;
  playerCardsModalBody.innerHTML = "";

  if (played.length === 0) {
    playerCardsModalBody.innerHTML = '<div class="text-dim" style="padding:1rem;">No cards played yet.</div>';
    playerCardsModal.classList.remove("hidden");
    return;
  }

  CARD_TYPE_GROUPS.forEach(group => {
    const matching = played.filter(c => c.card_type === group.key);
    if (matching.length === 0) return;
    const section = document.createElement("div");
    section.className = "modal-section";
    const h3 = document.createElement("h3");
    h3.textContent = group.label;
    section.appendChild(h3);
    const grid = document.createElement("div");
    grid.className = "hand-container";
    matching.forEach(card => {
      grid.appendChild(createCardElement(card));
    });
    section.appendChild(grid);
    playerCardsModalBody.appendChild(section);
  });

  playerCardsModal.classList.remove("hidden");
}

function renderPlayersCards(state) {
  if (!playersCardsListDiv) return;
  playersCardsListDiv.innerHTML = "";
  if (!state || !state.players) return;

  for (const [pid, p] of Object.entries(state.players)) {
    if (pid === myPlayerId) continue;
    const played = p.played_cards || [];
    const btn = document.createElement("button");
    btn.className = "btn btn-sm player-cards-btn";
    btn.style.borderLeft = `4px solid ${p.color || 'var(--text)'}`;
    btn.textContent = `${p.name} (${played.length} cards)`;
    btn.addEventListener("click", () => openPlayerCardsModal(pid));
    playersCardsListDiv.appendChild(btn);
  }
}

// ── Show Hand modal ─────────────────────────────────────────
showHandBtn.addEventListener("click", () => {
  if (!lastPrivateState) return;
  handModalBody.innerHTML = "";

  const allCards = [...(lastPrivateState.hand || [])];
  const me = lastGameState?.players?.[myPlayerId];
  if (me) {
    allCards.push(...(me.played_cards || []));
  }

  const playedNames = new Set(
    (lastGameState?.players?.[myPlayerId]?.played_cards || []).map(c => c.name)
  );

  CARD_TYPE_GROUPS.forEach(group => {
    const matching = allCards.filter(c => c.card_type === group.key);
    if (matching.length === 0) return;

    const section = document.createElement("div");
    section.className = "modal-section";
    const h3 = document.createElement("h3");
    h3.textContent = group.label;
    section.appendChild(h3);

    const grid = document.createElement("div");
    grid.className = "hand-container";
    matching.forEach(card => {
      const el = createCardElement(card);
      if (playedNames.has(card.name)) {
        el.classList.add("is-played");
        const badge = document.createElement("div");
        badge.className = "card-played-badge";
        badge.textContent = "PLAYED";
        el.insertBefore(badge, el.firstChild);
      }
      grid.appendChild(el);
    });
    section.appendChild(grid);
    handModalBody.appendChild(section);
  });

  handModal.classList.remove("hidden");
});

closeHandModal.addEventListener("click", () => handModal.classList.add("hidden"));
handModal.addEventListener("click", (e) => {
  if (e.target === handModal) handModal.classList.add("hidden");
});

// ── Sidebar renders ─────────────────────────────────────────
const RESOURCE_ORDER = ["money", "engineers", "suits", "servers", "ads"];
const RESOURCE_WIDE = new Set(["money"]);

function renderResources(resources) {
  resourcesDiv.innerHTML = "";
  if (resources.reputation !== undefined) updateReputationBar(resources.reputation);
  RESOURCE_ORDER.forEach(key => {
    const val = resources[key] ?? 0;
    const div = document.createElement("div");
    div.className = "resource-item";
    if (RESOURCE_WIDE.has(key)) div.classList.add("resource-wide");
    div.innerHTML = `<span class="label">${prettyRes(key)}</span><span class="value">${key === "money" ? `$${val}M` : val}</span>`;
    resourcesDiv.appendChild(div);
  });
}

function renderUsersPie() {
  const canvas = document.getElementById("users-pie");
  const info = document.getElementById("users-info");
  if (!canvas || !info || !lastGameState) return;

  const total = lastGameState.total_users || (lastGameState.params?.total_users ?? 500);
  const pool = lastGameState.user_pool ?? total;
  const players = lastGameState.players || {};
  const myId = lastPrivateState?.player_id;

  const slices = [];
  let myUsers = 0;
  for (const [pid, p] of Object.entries(players)) {
    const u = p.users || 0;
    if (u > 0) slices.push({ pid, name: p.name, users: u, color: p.color });
    if (pid === myId) myUsers = u;
  }
  if (pool > 0) slices.push({ pid: "__pool", name: "Uncaptured", users: pool, color: "#2a2a2a" });

  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 100;
  const cssH = canvas.clientHeight || 100;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;

  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  const cx = cssW / 2, cy = cssH / 2;
  const outerR = Math.min(cx, cy) - 2;
  const innerR = outerR * 0.52;
  const segGap = slices.length > 1 ? 0.02 : 0;

  ctx.clearRect(0, 0, cssW, cssH);

  let startAngle = -Math.PI / 2;
  const sliceAngles = [];
  for (const s of slices) {
    const sweep = (s.users / total) * 2 * Math.PI;
    const a0 = startAngle + segGap / 2;
    const a1 = startAngle + sweep - segGap / 2;

    ctx.beginPath();
    ctx.arc(cx, cy, outerR, a0, a1);
    ctx.arc(cx, cy, innerR, a1, a0, true);
    ctx.closePath();

    const grad = ctx.createRadialGradient(cx, cy, innerR, cx, cy, outerR);
    const base = s.color;
    grad.addColorStop(0, base);
    grad.addColorStop(1, darkenColor(base, 0.25));
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.strokeStyle = "#0a0a0a";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    sliceAngles.push({ ...s, start: startAngle, end: startAngle + sweep });
    startAngle += sweep;
  }

  ctx.beginPath();
  ctx.arc(cx, cy, innerR + 2, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(201,162,39,0.12)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.font = `bold ${Math.round(outerR * 0.28)}px 'Share Tech Mono', monospace`;
  ctx.fillStyle = "#7a7260";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("USERS", cx, cy);

  const myPct = total > 0 ? ((myUsers / total) * 100).toFixed(1) : "0.0";
  const mpu = lastGameState?.params?.money_per_users ?? 20;
  const income = mpu > 0 ? Math.floor(myUsers / mpu) : 0;
  const nextThreshold = mpu > 0 ? (Math.floor(myUsers / mpu) + 1) * mpu : 0;
  const hint = `${mpu * 10}M👥 → $1M/yr`;
  info.innerHTML = `<strong>👥 ${myUsers * 10}M</strong> <span class="pie-pct">${myPct}%</span><br><span class="pie-income">💰 $${income}M/yr</span><br><span class="pie-hint">${hint}</span>`;

  let pieTip = document.getElementById("pie-tooltip");
  if (!pieTip) {
    pieTip = document.createElement("div");
    pieTip.id = "pie-tooltip";
    pieTip.className = "pie-tooltip";
    canvas.parentElement.style.position = "relative";
    canvas.parentElement.appendChild(pieTip);
  }

  canvas.onmousemove = (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const x = mx - cx, y = my - cy;
    let angle = Math.atan2(y, x);
    if (angle < -Math.PI / 2) angle += 2 * Math.PI;
    const dist = Math.sqrt(x * x + y * y);
    pieTip.style.display = "none";
    if (dist >= innerR && dist <= outerR) {
      for (const s of sliceAngles) {
        let start = s.start, end = s.end;
        if (start < -Math.PI / 2) start += 2 * Math.PI;
        if (end < -Math.PI / 2) end += 2 * Math.PI;
        const a = angle >= 0 ? angle : angle + 2 * Math.PI;
        const sa = start >= 0 ? start : start + 2 * Math.PI;
        const ea = end >= 0 ? end : end + 2 * Math.PI;
        if ((sa <= ea && a >= sa && a < ea) || (sa > ea && (a >= sa || a < ea))) {
          const pct = ((s.users / total) * 100).toFixed(1);
          pieTip.textContent = `${s.name}: ${s.users * 10}M (${pct}%)`;
          pieTip.style.display = "block";
          pieTip.style.left = mx + 10 + "px";
          pieTip.style.top = my - 10 + "px";
          break;
        }
      }
    }
  };
  canvas.onmouseleave = () => { pieTip.style.display = "none"; };
}

function darkenColor(hex, amount) {
  let c = hex.replace("#", "");
  if (c.length === 3) c = c[0]+c[0]+c[1]+c[1]+c[2]+c[2];
  const n = parseInt(c, 16);
  const r = Math.max(0, Math.round(((n >> 16) & 0xff) * (1 - amount)));
  const g = Math.max(0, Math.round(((n >> 8) & 0xff) * (1 - amount)));
  const b = Math.max(0, Math.round((n & 0xff) * (1 - amount)));
  return `rgb(${r},${g},${b})`;
}

function updateReputationBar(val) {
  const marker = document.getElementById("reputation-marker");
  const valueEl = document.getElementById("reputation-value");
  const bar = document.getElementById("reputation-bar");
  if (!marker) return;
  const v = Math.round(val);
  const repMax = lastGameState?.params?.reputation_max ?? 10;
  const repMin = lastGameState?.params?.reputation_min ?? -10;
  const range = repMax - repMin;
  const clamped = Math.max(repMin, Math.min(repMax, v));
  const pct = ((clamped - repMin) / range) * 100;
  marker.style.left = pct + "%";
  marker.title = `Reputation: ${v}`;
  if (valueEl) valueEl.textContent = v;
  if (bar) {
    const mod = getRepMod(v);
    let status;
    if (mod > 0) status = `⭐ +${mod}👥 per gain, +${mod}🔧👔 per hire`;
    else if (mod < 0) status = `⚠️ ${mod}👥 per gain, ${mod}🔧👔 per hire`;
    else status = "No bonus or penalty";
    const thresh = lastGameState?.params?.reputation_thresholds || [];
    const threshStr = thresh.map(t =>
      "min_rep" in t ? `≥${t.min_rep}: ${t.modifier > 0 ? "+" : ""}${t.modifier}` :
      `≤${t.max_rep}: ${t.modifier > 0 ? "+" : ""}${t.modifier}`
    ).join(" | ");
    bar.setAttribute("data-tip", `Rep ${v}: ${status}\n${threshStr}`);
  }
}

const VALID_PRODUCTION = ["HR", "data_centers", "ad_campaigns"];
const PRODUCTION_WIDE = new Set(["HR"]);

function renderProduction(production) {
  productionDiv.innerHTML = "";
  VALID_PRODUCTION.forEach(key => {
    const val = production[key] ?? 0;
    const div = document.createElement("div");
    div.className = "resource-item";
    if (PRODUCTION_WIDE.has(key)) div.classList.add("resource-wide");
    const prefix = key === "HR" ? "+" : "";
    div.innerHTML = `<span class="label">${prettyRes(key)}</span><span class="value">${prefix}${val}</span>`;

    productionDiv.appendChild(div);
  });

  // Show money production only when non-zero (from factory_refund)
  const moneyProd = production["money"] ?? 0;
  if (moneyProd > 0) {
    const div = document.createElement("div");
    div.className = "resource-item resource-wide";
    div.innerHTML = `<span class="label">💰 Factory income</span><span class="value">$${moneyProd}M/yr</span>`;
    productionDiv.appendChild(div);
  }
}

// ── Helpers ──────────────────────────────────────────────────
const RES_EMOJI = {
  money: "💰", users: "👥", engineers: "🔧", suits: "👔",
  servers: "🖥️", ads: "📢", reputation: "⭐", HR: "🏢",
  data_centers: "🗄️", ad_campaigns: "📣",
};

function prettyRes(name) {
  const emoji = RES_EMOJI[name] || "";
  if (name === "money") return emoji;
  const label = name.replace(/_/g, " ");
  return emoji ? `${emoji} ${label}` : label;
}

function emojiRes(name) {
  return RES_EMOJI[name] || name.replace(/_/g, " ");
}

let cardNamesById = {};
function rebuildCardIndex() {
  cardNamesById = {};
  if (lastGameState?.card_names) {
    Object.assign(cardNamesById, lastGameState.card_names);
  }
  if (editorCards) {
    for (const cards of Object.values(editorCards)) {
      for (const card of (cards || [])) {
        if (card && card.id) cardNamesById[card.id] = card.name;
      }
    }
  }
}
function cardNameById(id) {
  return cardNamesById[id] || `#${id}`;
}

// ── Card element builder ────────────────────────────────────
const CARD_SUBTYPE_EMOJIS = {
  "social platform":          "📱",
  "hardware manufacturer":    "🏭",
  "software service":         "💻",
  "online marketplace":       "🛒",
  "search service":           "🔍",
  "store":                    "🏪",
  "power plant":              "⚡",
  "data center":              "🖥️",
  "office":                   "🏢",
  "ad campaign":              "📢",
};

const CARD_DECK_EMOJIS = {
  "cyber_attack":  "🕵️",
  "fuck_up":       "💀",
  "innovation":    "💡",
  "leverage":      "📈",
  "company":       "🏦",
  "regulation":    "⚖️",
};

function createCardElement(card, options = {}) {
  const el = document.createElement("div");
  el.className = "game-card";

  const colorType = card.card_color_type || card.type || "";
  const deckType = card.card_type || options.deckType || "";
  const typeEmoji = CARD_SUBTYPE_EMOJIS[colorType.toLowerCase()]
    || CARD_DECK_EMOJIS[deckType]
    || "";

  if (deckType === "fuck_up") el.classList.add("fuckup-card");

  const stripe = typeEmoji
    ? `<div class="card-type-emoji" title="${colorType || deckType}">${typeEmoji}</div>`
    : "";

  // Image placeholder
  const imageBlock = `<div class="card-image-placeholder">${card.image && !card.image.startsWith("<") ? `<img src="${card.image}" alt="">` : ""}</div>`;

  // Description
  const desc = card.description && !card.description.startsWith("<")
    ? `<p class="card-desc">${card.description}</p>` : "";

  // Effects (from effect dict for new cards, or immediate/production for legacy)
  let effectsHtml = "";
  if (card.effect && typeof card.effect === "object") {
    const effectEntries = Object.entries(card.effect)
      .filter(([k, v]) => v && k !== "payee_card_id");
    if (effectEntries.length) {
      effectsHtml = `<div class="card-effects"><span class="card-section-label">Effects</span><span class="card-effects-row">`;
      effectsHtml += effectEntries.map(([k, v]) => `<span class="card-effect-item">${v > 0 ? "+" : ""}${v} ${emojiRes(k)}</span>`).join("");
      effectsHtml += `</span></div>`;
    }
  } else {
    const prodText = Object.entries(card.production || {})
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `+${v} ${emojiRes(k)}/yr`).join(", ");
    const immText = Object.entries(card.immediate || {})
      .filter(([, v]) => v !== 0)
      .map(([k, v]) => `${v > 0 ? "+" : ""}${v} ${emojiRes(k)}`).join(", ");
    if (prodText) effectsHtml += `<div class="card-production">${prodText}</div>`;
    if (immText) effectsHtml += `<div class="card-immediate">${immText}</div>`;
  }

  // Boosts
  let boostsHtml = "";
  if (card.boosts && card.boosts.length) {
    boostsHtml = `<div class="card-boosts"><span class="card-section-label">Boosts</span><span class="card-effects-row">`;
    card.boosts.forEach(b => {
      const ids = Array.isArray(b.target_id) ? b.target_id : [b.target_id];
      const names = ids.map(id => cardNameById(id)).join(", ");
      const bonusEntries = Object.entries(b.bonus || {}).filter(([, v]) => v);
      if (bonusEntries.length) {
        boostsHtml += `<span class="card-boost-item">${names}: ${bonusEntries.map(([k, v]) => `${v > 0 ? "+" : ""}${v}${emojiRes(k)}`).join(" ")}</span>`;
      }
    });
    boostsHtml += `</span></div>`;
  }

  // Starting resources (company cards)
  let startHtml = "";
  const startEntries = Object.entries(card.starting_resources || {}).filter(([, v]) => v !== 0);
  const startProdEntries = Object.entries(card.starting_production || {}).filter(([, v]) => v !== 0);
  if (startEntries.length || startProdEntries.length) {
    startHtml = `<div class="card-effects"><span class="card-section-label">Starting</span><span class="card-effects-row">`;
    startHtml += startEntries.map(([k, v]) => `<span class="card-effect-item">${v} ${emojiRes(k)}</span>`).join("");
    startHtml += startProdEntries.map(([k, v]) => `<span class="card-effect-item">${v > 0 ? "+" : ""}${v} ${emojiRes(k)}/yr</span>`).join("");
    startHtml += `</span></div>`;
  }

  // Build badge
  let buildHtml = "";
  if (card.build) {
    const label = card.build.replace(/_/g, " ");
    buildHtml = `<div class="card-build-badge">🏗️ ${label}</div>`;
  }

  // Costs section (new format)
  let costsHtml = "";
  const costs = card.costs || {};
  const COST_SKIP = new Set(["fee", "fee_card_id", "payee_card_id"]);
  const hasCosts = Object.entries(costs).some(([k, v]) =>
    v && !COST_SKIP.has(k));
  if (hasCosts) {
    costsHtml = `<div class="card-costs"><span class="card-section-label">Cost</span>`;
    for (const [res, amt] of Object.entries(costs)) {
      if (!amt || COST_SKIP.has(res)) continue;
      costsHtml += `<span class="card-cost-item">${amt} ${emojiRes(res)}</span>`;
    }
    const feeAmt = costs.fee || 0;
    const feeTarget = costs.fee_card_id;
    if (feeAmt && feeTarget) {
      costsHtml += `<span class="card-cost-item card-cost-fee">💸 $${feeAmt}M → <em>${cardNameById(feeTarget)}</em> owner</span>`;
    }
    costsHtml += `</div>`;
  } else if (card.cost) {
    costsHtml = `<div class="card-costs"><span class="card-section-label">Cost</span><span class="card-cost-item">💰${card.cost}</span></div>`;
  }

  el.innerHTML = `
    ${stripe}
    <div class="card-header">
      <div class="card-name">${card.name}</div>
    </div>
    ${imageBlock}
    ${desc}
    ${effectsHtml}
    ${boostsHtml}
    ${buildHtml}
    ${startHtml}
    ${costsHtml}
  `;

  // Attach hover logic for cost choices
  if (options.interactive !== false) {
    el.querySelectorAll(".cost-option").forEach(opt => {
      opt.addEventListener("mouseenter", () => opt.classList.add("cost-hover"));
      opt.addEventListener("mouseleave", () => opt.classList.remove("cost-hover"));
    });
  }

  return el;
}

// ── Parameters editor ────────────────────────────────────────
const paramsModal = document.getElementById("params-modal");
const paramsBody = document.getElementById("params-body");

const PARAM_LABELS = {
  total_users: "Total Users in Pool (×10M)",
  money_per_users: "Users per $1M/year",
  projects_draw: "Cards from Projects Deck",
  boosters_draw: "Cards from Boosters Deck",
  draft_cost: "Cost to Keep a Card ($)",
  cards_per_turn: "Cards Playable per Turn",
  company_offers: "Company Cards per Player",
  buy_server_engineers: "Buy Server: Engineers",
  buy_server_money: "Buy Server: Money ($M)",
  buy_ad_suits: "Buy Ad: Suits",
  buy_ad_money: "Buy Ad: Money ($M)",
  reputation_max: "Reputation Max",
  reputation_min: "Reputation Min",
};

let currentParams = {};

function renderParamsForm(params) {
  currentParams = { ...params };
  paramsBody.innerHTML = "";
  const form = document.createElement("div");
  form.className = "params-form";

  for (const [key, value] of Object.entries(params)) {
    if (key === "reputation_thresholds") continue;
    const row = document.createElement("div");
    row.className = "param-row";
    const label = document.createElement("label");
    label.textContent = PARAM_LABELS[key] || key.replace(/_/g, " ");
    const input = document.createElement("input");
    input.type = "number";
    input.className = "param-input";
    input.value = value;
    input.dataset.key = key;
    input.addEventListener("change", () => {
      currentParams[key] = Number(input.value);
    });
    row.appendChild(label);
    row.appendChild(makeNumSpinner(input, { min: 0 }));
    form.appendChild(row);
  }

  const threshTitle = document.createElement("h3");
  threshTitle.textContent = "Reputation Thresholds";
  threshTitle.style.cssText = "margin-top:1rem;font-size:.9rem;";
  form.appendChild(threshTitle);

  const thresholds = params.reputation_thresholds || [];
  thresholds.forEach((t, i) => {
    const row = document.createElement("div");
    row.className = "param-row";
    const isMin = "min_rep" in t;
    const label = document.createElement("label");
    label.textContent = isMin ? `Rep ≥ ${t.min_rep} → modifier` : `Rep ≤ ${t.max_rep} → modifier`;
    const repInput = document.createElement("input");
    repInput.type = "number";
    repInput.className = "param-input param-input-sm";
    repInput.value = isMin ? t.min_rep : t.max_rep;
    repInput.addEventListener("change", () => {
      if (isMin) currentParams.reputation_thresholds[i].min_rep = Number(repInput.value);
      else currentParams.reputation_thresholds[i].max_rep = Number(repInput.value);
    });
    const modInput = document.createElement("input");
    modInput.type = "number";
    modInput.className = "param-input param-input-sm";
    modInput.value = t.modifier;
    modInput.addEventListener("change", () => {
      currentParams.reputation_thresholds[i].modifier = Number(modInput.value);
    });
    row.appendChild(label);
    row.appendChild(makeNumSpinner(repInput));
    row.appendChild(makeNumSpinner(modInput));
    form.appendChild(row);
  });

  const saveBtn = document.createElement("button");
  saveBtn.className = "btn btn-primary";
  saveBtn.textContent = "Save Parameters";
  saveBtn.style.cssText = "margin-top:1rem;width:100%;";
  saveBtn.addEventListener("click", () => {
    socket.emit("save_params", currentParams);
  });
  form.appendChild(saveBtn);

  paramsBody.appendChild(form);
}

document.getElementById("edit-params-btn").addEventListener("click", () => {
  socket.emit("get_params");
});
document.getElementById("edit-params-lobby-btn").addEventListener("click", () => {
  socket.emit("get_params");
});
document.getElementById("close-params-modal").addEventListener("click", () => {
  paramsModal.classList.add("hidden");
});
paramsModal.addEventListener("click", (e) => {
  if (e.target === paramsModal) paramsModal.classList.add("hidden");
});

socket.on("params_data", (data) => {
  renderParamsForm(data);
  paramsModal.classList.remove("hidden");
});

// ── Fetch Data (browser writes to local filesystem) ─────────
let _fetchDataDirHandle = null;
const _IDB_NAME = "technopoly";
const _IDB_STORE = "handles";

function _openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(_IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(_IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function _saveHandle(handle) {
  const db = await _openIDB();
  const tx = db.transaction(_IDB_STORE, "readwrite");
  tx.objectStore(_IDB_STORE).put(handle, "dataDir");
  return new Promise(r => { tx.oncomplete = r; });
}
async function _loadHandle() {
  const db = await _openIDB();
  const tx = db.transaction(_IDB_STORE, "readonly");
  const req = tx.objectStore(_IDB_STORE).get("dataDir");
  return new Promise(r => { req.onsuccess = () => r(req.result || null); });
}

async function _getDirHandle() {
  if (_fetchDataDirHandle) {
    const perm = await _fetchDataDirHandle.queryPermission({ mode: "readwrite" });
    if (perm === "granted") return _fetchDataDirHandle;
    const req = await _fetchDataDirHandle.requestPermission({ mode: "readwrite" });
    if (req === "granted") return _fetchDataDirHandle;
  }
  const saved = await _loadHandle();
  if (saved) {
    const perm = await saved.requestPermission({ mode: "readwrite" });
    if (perm === "granted") { _fetchDataDirHandle = saved; return saved; }
  }
  const picked = await window.showDirectoryPicker({ mode: "readwrite" });
  _fetchDataDirHandle = picked;
  await _saveHandle(picked);
  return picked;
}

async function _doFetchData() {
  if (!window.showDirectoryPicker) {
    showFloatingError("This browser does not support direct file writing. Use Chrome or Edge.");
    return;
  }
  try {
    const dirHandle = await _getDirHandle();
    const password = _savedCredentials?.password || "";
    const resp = await fetch("/api/fetch_data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password })
    });
    if (!resp.ok) { showFloatingError("Fetch failed: unauthorized or server error."); return; }
    const data = await resp.json();

    const cardsDir = await dirHandle.getDirectoryHandle("cards", { create: true });
    for (const [name, content] of Object.entries(data.cards || {})) {
      const fh = await cardsDir.getFileHandle(name, { create: true });
      const writable = await fh.createWritable();
      await writable.write(content);
      await writable.close();
    }
    if (data.params) {
      const fh = await dirHandle.getFileHandle("params.yaml", { create: true });
      const writable = await fh.createWritable();
      await writable.write(data.params);
      await writable.close();
    }
    showFloatingSuccess("✓ Data fetched and saved locally.");
  } catch (e) {
    if (e.name === "AbortError") return;
    showFloatingError(`Fetch error: ${e.message}`);
  }
}

document.getElementById("fetch-data-btn").addEventListener("click", _doFetchData);
document.getElementById("fetch-data-lobby-btn").addEventListener("click", _doFetchData);
document.getElementById("fetch-data-card-editor").addEventListener("click", _doFetchData);
document.getElementById("fetch-data-board-editor").addEventListener("click", _doFetchData);
document.getElementById("fetch-data-params-editor").addEventListener("click", _doFetchData);

// ── End / Restart game ──────────────────────────────────────
endGameBtn.addEventListener("click", () => {
  showConfirmDialog(
    "Are you sure you want to end the game?",
    () => socket.emit("end_game"),
    { detail: "All players will be logged out.", confirmText: "End Game" }
  );
});

restartGameBtn.addEventListener("click", () => {
  showConfirmDialog(
    "Restart the game?",
    () => socket.emit("restart_game"),
    { detail: "Everything resets to company pick.", confirmText: "Restart" }
  );
});

// ── Actions ─────────────────────────────────────────────────
endTurnBtn.addEventListener("click", () => socket.emit("end_turn"));
endYearBtn.addEventListener("click", () => {
  showConfirmDialog(
    "End your fiscal year?",
    () => socket.emit("end_year"),
    { detail: "You won't play any more cards this year.", confirmText: "End Year" }
  );
});

document.getElementById("buy-server-btn").addEventListener("click", () => {
  socket.emit("buy_resource", { type: "server" });
});
document.getElementById("buy-ad-btn").addEventListener("click", () => {
  socket.emit("buy_resource", { type: "ad" });
});

// ── Error toast ─────────────────────────────────────────────
function showFloatingError(msg) {
  gameError.textContent = msg;
  gameError.classList.remove("floating-success");
  gameError.classList.add("visible");
  setTimeout(() => gameError.classList.remove("visible"), 3000);
}
function showFloatingSuccess(msg) {
  gameError.textContent = msg;
  gameError.classList.add("floating-success", "visible");
  setTimeout(() => { gameError.classList.remove("visible", "floating-success"); }, 4000);
}

// ══════════════════════════════════════════════════════════════
// ── Card Editor ──────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════

let editorCards = {};
let editorLocksMap = {};
let editingKey = null;
let editorContext = "grid"; // "grid" | "trees"
let editorScrollTop = 0;

const DICT_FIELDS = new Set([
  "production", "immediate", "starting_resources", "starting_production",
  "compliance", "court_penalty", "costs", "effect",
]);

const RESOURCE_OPTIONS = [
  "users", "money", "engineers", "suits", "servers", "ads", "reputation", "HR",
  "data_centers", "ad_campaigns",
];

const COST_KEY_OPTIONS = [
  "engineers", "suits", "ads", "money",
  "servers", "data_centers", "ad_campaigns",
  "reputation", "HR", "users", "fee", "fee_card_id",
];

const DICT_KEY_OPTIONS = {
  effect: RESOURCE_OPTIONS,
  costs: COST_KEY_OPTIONS,
  compliance: RESOURCE_OPTIONS,
  court_penalty: RESOURCE_OPTIONS,
  starting_resources: RESOURCE_OPTIONS,
  starting_production: ["HR", "data_centers", "ad_campaigns"],
};

const EDITOR_TYPE_LABELS = {
  company: "Company",
  platform: "Platform",
  cyber_attack: "Cyber Attacks",
  fuck_up: "Fuck-ups",
  leverage: "Leverage",
  innovation: "Innovation",
  build: "Build",
  regulation: "Regulation",
};

const editorTotalCount = document.getElementById("editor-total-count");
const editorSearch = document.getElementById("editor-search");
const cardTreesBtn = document.getElementById("card-trees-btn");
const treesModal = document.getElementById("trees-modal");
const closeTreesModal = document.getElementById("close-trees-modal");
const treesStats = document.getElementById("trees-stats");
const treesSearch = document.getElementById("trees-search");
const treesBody = document.getElementById("trees-body");

editCardsBtn.addEventListener("click", () => {
  editorContext = "grid";
  socket.emit("get_all_cards");
});

document.getElementById("edit-cards-lobby-btn").addEventListener("click", () => {
  editorContext = "grid";
  socket.emit("get_all_cards");
});

socket.on("editor_error", (data) => {
  showFloatingError(data.message);
});

closeEditorModal.addEventListener("click", () => {
  if (editingKey) {
    const fields = editorBody.querySelector(".editor-fields");
    if (fields) {
      const [ct, idx] = editingKey.split(":");
      const card = editorCards[ct]?.[parseInt(idx)];
      if (card) {
        const cardData = collectFormData(fields, card);
        socket.emit("save_card", { card_type: ct, index: parseInt(idx), card_data: cardData });
      }
    }
    editingKey = null;
  }
  editorModal.classList.add("hidden");
});

editorModal.addEventListener("click", (e) => {
  if (e.target === editorModal) closeEditorModal.click();
});

socket.on("all_cards", (data) => {
  editorCards = data.cards;
  editorLocksMap = data.locks || {};
  rebuildCardIndex();
  if (!editingKey) renderEditorGrid();
  editorModal.classList.remove("hidden");
  editorTitle.textContent = "Card Editor";
});

socket.on("card_locked", (data) => {
  editorLocksMap[data.key] = data.who;
});

socket.on("card_unlocked", (data) => {
  delete editorLocksMap[data.key];
});

socket.on("lock_result", (data) => {
  if (data.success) {
    editingKey = data.key;
    if (editorContext === "trees") {
      renderTreeEditForm();
    } else {
      renderEditorForm();
    }
  } else {
    showFloatingError(data.message);
  }
});

editorSearch.addEventListener("input", () => renderEditorGrid());

// ── Editor Grid ──────────────────────────────────────────────
function renderEditorGrid() {
  editorBody.innerHTML = "";
  editingKey = null;
  requestAnimationFrame(() => { editorBody.scrollTop = editorScrollTop; });
  editorTitle.textContent = "Card Editor";

  const query = (editorSearch.value || "").toLowerCase().trim();

  const DECK_MAP = {
    platform: "Projects", cyber_attack: "Projects", fuck_up: "Projects",
    leverage: "Boosters", innovation: "Boosters", build: "Boosters",
  };
  let totalCards = 0;
  const typeCounts = {};
  const deckCounts = {};
  for (const [ct, cards] of Object.entries(editorCards)) {
    if (ct === "company" || ct === "regulation") continue;
    const n = (cards || []).length;
    totalCards += n;
    typeCounts[ct] = n;
    const deck = DECK_MAP[ct] || ct;
    deckCounts[deck] = (deckCounts[deck] || 0) + n;
  }
  function roundedPcts(items, total) {
    const t = total || items.reduce((a, b) => a + b, 0);
    if (!t) return items.map(() => 0);
    const raw = items.map(n => (n / t) * 100);
    const floored = raw.map(r => Math.floor(r));
    let remainder = 100 - floored.reduce((a, b) => a + b, 0);
    const fracs = raw.map((r, i) => ({ i, frac: r - floored[i] }));
    fracs.sort((a, b) => b.frac - a.frac);
    for (let j = 0; j < remainder && j < fracs.length; j++) floored[fracs[j].i]++;
    return floored;
  }

  const deckEntries = Object.entries(deckCounts);
  const deckPcts = roundedPcts(deckEntries.map(([, c]) => c), totalCards);
  let statsHtml = `Total: ${totalCards} | `;
  deckEntries.forEach(([deck, count], di) => {
    const typeEntries = Object.entries(typeCounts)
      .filter(([ct]) => (DECK_MAP[ct] || ct) === deck);
    const typePcts = roundedPcts(typeEntries.map(([, n]) => n), count);
    const types = typeEntries.map(([ct, n], ti) => {
      const label = CARD_TYPE_GROUPS.find(g => g.key === ct)?.label || ct;
      return `${label}: ${n} (${typePcts[ti]}%)`;
    }).join(", ");
    statsHtml += `<strong>${deck}</strong> ${count} (${deckPcts[di]}%) [${types}] `;
  });
  editorTotalCount.innerHTML = statsHtml;

  for (const [cardType, cards] of Object.entries(editorCards)) {
    const filtered = (cards || []).map((card, index) => ({ card, index }));
    const visible = query
      ? filtered.filter(({ card }) =>
          (card.name || "").toLowerCase().includes(query) ||
          String(card.id ?? "").includes(query))
      : filtered;

    if (visible.length === 0 && query) continue;

    const section = document.createElement("div");
    section.className = "editor-section";

    const headerRow = document.createElement("div");
    headerRow.className = "editor-section-header";

    const h3 = document.createElement("h3");
    h3.className = "editor-section-title";
    const countLabel = query
      ? `${visible.length} / ${(cards || []).length}`
      : `${(cards || []).length}`;
    h3.textContent = `${EDITOR_TYPE_LABELS[cardType] || cardType} (${countLabel})`;
    headerRow.appendChild(h3);

    const addBtn = document.createElement("button");
    addBtn.className = "btn btn-sm editor-add-card-btn";
    addBtn.textContent = "+ Add Card";
    addBtn.addEventListener("click", () => {
      editorContext = "grid";
      socket.emit("add_card", { card_type: cardType });
    });
    headerRow.appendChild(addBtn);

    section.appendChild(headerRow);

    const grid = document.createElement("div");
    grid.className = "editor-grid";

    visible.forEach(({ card, index }) => {
      const key = `${cardType}:${index}`;
      const lockStatus = editorLocksMap[key];

      const wrapper = document.createElement("div");
      wrapper.className = "editor-card-wrapper";
      if (lockStatus === "other") wrapper.classList.add("editor-card-locked");

      const cardEl = createCardElement(card, { interactive: false, deckType: cardType });

      const overlay = document.createElement("div");
      overlay.className = "editor-card-overlay";

      const idBadge = document.createElement("span");
      idBadge.className = "editor-card-id-badge";
      const numLabel = (card.number && card.number > 1) ? ` ×${card.number}` : "";
      idBadge.textContent = `ID: ${card.id ?? "\u2014"}${numLabel}`;
      overlay.appendChild(idBadge);

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "editor-card-delete";
      deleteBtn.textContent = "\u00d7";
      deleteBtn.title = "Delete card";
      deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (lockStatus === "other") {
          showFloatingError("Card is locked by another editor.");
          return;
        }
        editorScrollTop = editorBody.scrollTop;
        showConfirmDialog(
          `Delete "${card.name || "Unnamed"}"?`,
          () => socket.emit("delete_card", { card_type: cardType, index }),
          { detail: "It will be moved to the Graveyard.", confirmText: "Delete" }
        );
      });
      overlay.appendChild(deleteBtn);

      if (lockStatus === "other") {
        const lockLabel = document.createElement("div");
        lockLabel.className = "editor-lock-indicator";
        lockLabel.textContent = "Locked";
        overlay.appendChild(lockLabel);
      }

      wrapper.appendChild(overlay);
      wrapper.appendChild(cardEl);

      if (lockStatus !== "other") {
        wrapper.style.cursor = "pointer";
        wrapper.addEventListener("click", () => {
          editorContext = "grid";
          editorScrollTop = editorBody.scrollTop;
          socket.emit("lock_card", { card_type: cardType, index });
        });
      }

      grid.appendChild(wrapper);
    });

    section.appendChild(grid);
    editorBody.appendChild(section);
  }
}

// ── Editor Form ──────────────────────────────────────────────
function renderEditorForm() {
  if (!editingKey) return;
  const [cardType, idxStr] = editingKey.split(":");
  const index = parseInt(idxStr);
  const card = editorCards[cardType]?.[index];
  if (!card) return;

  editorTitle.textContent = `Editing: ${card.name}`;
  editorBody.innerHTML = "";

  const form = document.createElement("div");
  form.className = "editor-form";

  const fields = document.createElement("div");
  fields.className = "editor-fields";

  const EDITOR_HIDDEN_FIELDS = new Set(["image", "starting_tiles"]);
  const ALWAYS_SHOW_FIELDS = ["factory_refund", "dc_production_bonus"];
  const renderedKeys = new Set();

  for (const [key, value] of Object.entries(card)) {
    if (EDITOR_HIDDEN_FIELDS.has(key)) continue;
    renderedKeys.add(key);
    if (key === "boosts") {
      fields.appendChild(buildBoostsField(value || []));
    } else if (DICT_FIELDS.has(key) && value && typeof value === "object") {
      fields.appendChild(buildDictField(key, value));
    } else {
      fields.appendChild(buildSimpleField(key, value));
    }
  }

  // Always show these fields even if absent from the card data
  for (const key of ALWAYS_SHOW_FIELDS) {
    if (!renderedKeys.has(key)) {
      fields.appendChild(buildSimpleField(key, null));
    }
  }

  if (!("boosts" in card)) {
    fields.appendChild(buildBoostsField([]));
  }

  function saveAndGoBack() {
    const cardData = collectFormData(fields, card);
    socket.emit("save_card", { card_type: cardType, index, card_data: cardData });
    editingKey = null;
    setTimeout(() => socket.emit("get_all_cards"), 300);
  }

  const backBtn = document.createElement("button");
  backBtn.className = "btn btn-sm";
  backBtn.textContent = "\u2190 Back to all cards (auto-saves)";
  backBtn.addEventListener("click", saveAndGoBack);
  form.appendChild(backBtn);

  form.appendChild(fields);

  const actions = document.createElement("div");
  actions.className = "editor-form-actions";

  const saveBtn = document.createElement("button");
  saveBtn.className = "btn btn-sm btn-accent";
  saveBtn.textContent = "Save";
  saveBtn.addEventListener("click", () => {
    const cardData = collectFormData(fields, card);
    socket.emit("save_card", { card_type: cardType, index, card_data: cardData });
  });

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn btn-sm";
  cancelBtn.textContent = "Discard changes";
  cancelBtn.addEventListener("click", () => {
    socket.emit("unlock_card", { card_type: cardType, index });
    editingKey = null;
    renderEditorGrid();
  });

  actions.appendChild(saveBtn);
  actions.appendChild(cancelBtn);
  form.appendChild(actions);
  editorBody.appendChild(form);
}

const FIELD_OPTIONS = {
  build: [null, "ad_campaign", "data_center", "factory", "lobby_group", "office", "power_plant", "store"],
  type: [
    null,
    "social platform", "hardware manufacturer", "software service",
    "online marketplace", "search service", "store", "power plant",
    "data center", "office", "ad campaign",
  ],
};

// Fields that are always numeric (even when their current value is null)
const NUMERIC_FIELDS = new Set(["factory_refund", "dc_production_bonus"]);

function buildSimpleField(key, value) {
  const row = document.createElement("div");
  row.className = "editor-field";

  const label = document.createElement("label");
  label.textContent = key;
  row.appendChild(label);

  if (FIELD_OPTIONS[key]) {
    const sel = document.createElement("select");
    sel.dataset.fieldKey = key;
    FIELD_OPTIONS[key].forEach(opt => {
      const o = document.createElement("option");
      o.value = opt ?? "";
      o.textContent = opt ?? "(none)";
      if ((value ?? null) === opt) o.selected = true;
      sel.appendChild(o);
    });
    row.appendChild(sel);
  } else if (key === "description") {
    const ta = document.createElement("textarea");
    ta.dataset.fieldKey = key;
    ta.value = value ?? "";
    ta.rows = 3;
    row.appendChild(ta);
  } else {
    const input = document.createElement("input");
    input.dataset.fieldKey = key;
    const isNum = typeof value === "number" || NUMERIC_FIELDS.has(key) || key === "id";
    input.type = isNum ? "number" : "text";
    input.value = value ?? "";
    row.appendChild(input);
  }

  return row;
}

function buildDictField(key, dict) {
  const container = document.createElement("div");
  container.className = "editor-dict-field";
  container.dataset.dictKey = key;

  const prettyLabel = key === "effect" ? "Effects" : key;
  const label = document.createElement("label");
  label.className = "editor-dict-label";
  label.textContent = prettyLabel;
  container.appendChild(label);

  const opts = DICT_KEY_OPTIONS[key] || null;
  const entries = dict && typeof dict === "object" ? Object.entries(dict) : [];
  entries.forEach(([k, v]) => container.appendChild(buildDictRow(k, v, opts)));

  const addBtn = document.createElement("button");
  addBtn.className = "btn btn-sm editor-add-btn";
  addBtn.textContent = "+ Add field";
  addBtn.addEventListener("click", () => container.insertBefore(buildDictRow("", 0, opts), addBtn));
  container.appendChild(addBtn);

  return container;
}

function buildDictRow(k, v, keyOptions) {
  const row = document.createElement("div");
  row.className = "editor-dict-row";

  let keyEl;
  if (keyOptions && keyOptions.length > 0) {
    keyEl = document.createElement("select");
    keyEl.className = "editor-dict-key";
    keyOptions.forEach(opt => {
      const o = document.createElement("option");
      o.value = opt;
      o.textContent = opt;
      if (opt === k) o.selected = true;
      keyEl.appendChild(o);
    });
  } else {
    keyEl = document.createElement("input");
    keyEl.type = "text";
    keyEl.className = "editor-dict-key";
    keyEl.value = k;
    keyEl.placeholder = "key";
  }

  const valInput = document.createElement("input");
  valInput.type = (v === null || v === undefined) ? "text" : "number";
  valInput.className = "editor-dict-val";
  valInput.value = (v === null || v === undefined) ? "" : v;
  valInput.placeholder = "value";

  const removeBtn = document.createElement("button");
  removeBtn.className = "btn btn-sm editor-remove-btn";
  removeBtn.textContent = "\u00d7";
  removeBtn.addEventListener("click", () => row.remove());

  row.appendChild(keyEl);
  if (valInput.type === "number") {
    row.appendChild(makeNumSpinner(valInput));
  } else {
    row.appendChild(valInput);
  }
  row.appendChild(removeBtn);
  return row;
}

// ── Boosts field builder ─────────────────────────────────────
function buildBoostsField(boosts) {
  const container = document.createElement("div");
  container.className = "editor-boosts-field";
  container.dataset.boostsKey = "boosts";

  const label = document.createElement("label");
  label.className = "editor-dict-label";
  label.textContent = "boosts";
  container.appendChild(label);

  (boosts || []).forEach(boost => container.appendChild(buildBoostEntry(boost)));

  const addBtn = document.createElement("button");
  addBtn.className = "btn btn-sm editor-add-btn";
  addBtn.textContent = "+ Add boost";
  addBtn.addEventListener("click", () => {
    container.insertBefore(buildBoostEntry({ target_id: 0, bonus: {} }), addBtn);
  });
  container.appendChild(addBtn);

  return container;
}

function buildBoostEntry(boost) {
  const entry = document.createElement("div");
  entry.className = "editor-boost-entry";

  const tidRow = document.createElement("div");
  tidRow.className = "editor-dict-row";
  const tidLabel = document.createElement("span");
  tidLabel.className = "editor-boost-label";
  tidLabel.textContent = "target_id:";
  const tidInput = document.createElement("input");
  tidInput.type = "number";
  tidInput.className = "boost-target-id";
  tidInput.value = boost.target_id || 0;
  const removeEntry = document.createElement("button");
  removeEntry.className = "btn btn-sm editor-remove-btn";
  removeEntry.textContent = "\u00d7";
  removeEntry.addEventListener("click", () => entry.remove());
  tidRow.appendChild(tidLabel);
  tidRow.appendChild(makeNumSpinner(tidInput, { min: 0 }));
  tidRow.appendChild(removeEntry);
  entry.appendChild(tidRow);

  const bonusLabel = document.createElement("span");
  bonusLabel.className = "editor-boost-label";
  bonusLabel.textContent = "bonus:";
  entry.appendChild(bonusLabel);

  const bonusContainer = document.createElement("div");
  bonusContainer.className = "boost-bonus-rows";
  Object.entries(boost.bonus || {}).forEach(([k, v]) => {
    bonusContainer.appendChild(buildDictRow(k, v, RESOURCE_OPTIONS));
  });
  const addBonusBtn = document.createElement("button");
  addBonusBtn.className = "btn btn-sm editor-add-btn";
  addBonusBtn.textContent = "+ Add bonus field";
  addBonusBtn.addEventListener("click", () => {
    bonusContainer.insertBefore(buildDictRow("", 0, RESOURCE_OPTIONS), addBonusBtn);
  });
  bonusContainer.appendChild(addBonusBtn);
  entry.appendChild(bonusContainer);

  return entry;
}

// ── Collect form data ────────────────────────────────────────
function collectFormData(fieldsEl, originalCard) {
  const data = {};

  fieldsEl.querySelectorAll(":scope > .editor-field").forEach(row => {
    const el = row.querySelector("input, textarea, select");
    if (!el) return;
    const key = el.dataset.fieldKey;
    let val = el.value;
    if (el.tagName === "SELECT") {
      val = val === "" ? null : val;
    } else if (el.type === "number") {
      val = val === "" ? 0 : Number(val);
    } else if (val === "" || val === "null") {
      val = null;
    }
    data[key] = val;
  });

  fieldsEl.querySelectorAll(":scope > .editor-dict-field").forEach(container => {
    const dictKey = container.dataset.dictKey;
    const dict = {};
    container.querySelectorAll(".editor-dict-row").forEach(row => {
      const k = row.querySelector(".editor-dict-key").value.trim();
      const raw = row.querySelector(".editor-dict-val").value;
      const v = (raw === "" || raw === "null") ? null : Number(raw);
      if (k) dict[k] = v;
    });
    data[dictKey] = Object.keys(dict).length > 0 ? dict : null;
  });

  const boostsContainer = fieldsEl.querySelector(".editor-boosts-field");
  if (boostsContainer) {
    const boosts = [];
    boostsContainer.querySelectorAll(".editor-boost-entry").forEach(entry => {
      const tid = Number(entry.querySelector(".boost-target-id").value) || 0;
      const bonus = {};
      entry.querySelectorAll(".boost-bonus-rows .editor-dict-row").forEach(row => {
        const k = row.querySelector(".editor-dict-key").value.trim();
        const v = Number(row.querySelector(".editor-dict-val").value) || 0;
        if (k) bonus[k] = v;
      });
      if (tid) boosts.push({ target_id: tid, bonus });
    });
    data.boosts = boosts.length > 0 ? boosts : null;
  }

  return data;
}

// ══════════════════════════════════════════════════════════════
// ── Card Trees ───────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════

let treesData = null;
let treesLocksMap = {};

cardTreesBtn.addEventListener("click", () => {
  socket.emit("get_card_trees");
});

closeTreesModal.addEventListener("click", () => {
  if (editingKey) {
    const [ct, idx] = editingKey.split(":");
    socket.emit("unlock_card", { card_type: ct, index: parseInt(idx) });
    editingKey = null;
  }
  treesModal.classList.add("hidden");
  editorModal.classList.remove("hidden");
});

treesModal.addEventListener("click", (e) => {
  if (e.target === treesModal) closeTreesModal.click();
});

socket.on("card_trees", (data) => {
  treesData = data;
  treesLocksMap = data.locks || {};
  treesSearch.value = "";
  renderTreesView();
  treesModal.classList.remove("hidden");
});

treesSearch.addEventListener("input", () => renderTreesView());

function renderTreesView() {
  if (!treesData) return;
  const { trees, stats } = treesData;
  const query = (treesSearch.value || "").toLowerCase().trim();

  treesStats.innerHTML = `
    <div class="trees-stat"><strong>Trees:</strong> ${stats.total_trees}</div>
    <div class="trees-stat"><strong>Avg boosters/tree:</strong> ${stats.avg_boosters_per_tree}</div>
    <div class="trees-stat"><strong>Total connections:</strong> ${stats.total_connections}</div>
    <div class="trees-stat"><strong>Unconnected platforms:</strong> ${stats.unconnected_platforms} / ${stats.total_platform_cards}</div>
    <div class="trees-stat"><strong>Unconnected boosters:</strong> ${stats.unconnected_boosters} / ${stats.total_booster_cards}</div>
  `;

  treesBody.innerHTML = "";
  editingKey = null;

  if (trees.length === 0) {
    treesBody.innerHTML = '<p class="text-dim" style="padding:1rem;">No card connections found. Add boosts to leverage/innovation cards to create trees.</p>';
    return;
  }

  const filteredTrees = query
    ? trees.filter(tree => {
        const targetMatch = (tree.target.name || "").toLowerCase().includes(query) ||
          String(tree.target.id ?? "").includes(query);
        const boosterMatch = tree.boosters.some(b =>
          (b.card.name || "").toLowerCase().includes(query) ||
          String(b.card.id ?? "").includes(query));
        return targetMatch || boosterMatch;
      })
    : trees;

  if (filteredTrees.length === 0) {
    treesBody.innerHTML = '<p class="text-dim" style="padding:1rem;">No trees match your search.</p>';
    return;
  }

  filteredTrees.forEach((tree, treeIdx) => {
    const treeEl = document.createElement("div");
    treeEl.className = "tree-group";

    const treeTitle = document.createElement("h3");
    treeTitle.className = "tree-title";
    treeTitle.textContent = `Tree ${treeIdx + 1}`;
    treeEl.appendChild(treeTitle);

    const treeLayout = document.createElement("div");
    treeLayout.className = "tree-layout";

    const boostersCol = document.createElement("div");
    boostersCol.className = "tree-boosters-col";

    tree.boosters.forEach(b => {
      const row = document.createElement("div");
      row.className = "tree-booster-row";

      const wrapper = document.createElement("div");
      wrapper.className = "tree-card-wrapper";

      const boosterLockKey = findEditorKeyForId(b.card.id, b.card_type);
      const lockStatus = boosterLockKey ? (treesLocksMap[boosterLockKey] || null) : null;
      if (lockStatus === "other") wrapper.classList.add("editor-card-locked");

      const cardEl = createCardElement(b.card, { interactive: false, deckType: b.card_type });

      const bonusTag = document.createElement("div");
      bonusTag.className = "tree-bonus-tag";
      bonusTag.textContent = `Boost: ${Object.entries(b.bonus).map(([k,v]) => `${v > 0 ? "+" : ""}${v} ${emojiRes(k)}`).join(" ") || "none"}`;

      if (lockStatus === "other") {
        const lockLabel = document.createElement("div");
        lockLabel.className = "editor-lock-indicator";
        lockLabel.textContent = "Locked";
        wrapper.appendChild(lockLabel);
      }

      wrapper.appendChild(cardEl);
      wrapper.appendChild(bonusTag);

      if (lockStatus !== "other" && boosterLockKey) {
        wrapper.style.cursor = "pointer";
        wrapper.addEventListener("click", () => {
          editorContext = "trees";
          const [ct, idx] = boosterLockKey.split(":");
          socket.emit("lock_card", { card_type: ct, index: parseInt(idx) });
        });
      }

      const arrow = document.createElement("div");
      arrow.className = "tree-arrow";
      arrow.textContent = "\u2192";

      row.appendChild(wrapper);
      row.appendChild(arrow);
      boostersCol.appendChild(row);
    });

    treeLayout.appendChild(boostersCol);

    const targetWrapper = document.createElement("div");
    targetWrapper.className = "tree-card-wrapper tree-target-wrapper";

    const targetLockKey = findEditorKeyForId(tree.target.id, tree.target_type);
    const targetLock = targetLockKey ? (treesLocksMap[targetLockKey] || null) : null;
    if (targetLock === "other") targetWrapper.classList.add("editor-card-locked");

    const targetCardEl = createCardElement(tree.target, { interactive: false, deckType: tree.target_type });

    if (targetLock === "other") {
      const lockLabel = document.createElement("div");
      lockLabel.className = "editor-lock-indicator";
      lockLabel.textContent = "Locked";
      targetWrapper.appendChild(lockLabel);
    }

    targetWrapper.appendChild(targetCardEl);

    if (targetLock !== "other" && targetLockKey) {
      targetWrapper.style.cursor = "pointer";
      targetWrapper.addEventListener("click", () => {
        editorContext = "trees";
        const [ct, idx] = targetLockKey.split(":");
        socket.emit("lock_card", { card_type: ct, index: parseInt(idx) });
      });
    }

    treeLayout.appendChild(targetWrapper);

    treeEl.appendChild(treeLayout);
    treesBody.appendChild(treeEl);
  });
}

function findEditorKeyForId(cardId, cardType) {
  const cards = editorCards[cardType];
  if (!cards) return null;
  const idx = cards.findIndex(c => c.id === cardId);
  return idx >= 0 ? `${cardType}:${idx}` : null;
}

function renderTreeEditForm() {
  if (!editingKey) return;
  const [cardType, idxStr] = editingKey.split(":");
  const index = parseInt(idxStr);
  const card = editorCards[cardType]?.[index];
  if (!card) return;

  treesBody.innerHTML = "";

  const form = document.createElement("div");
  form.className = "editor-form";

  const fields = document.createElement("div");
  fields.className = "editor-fields";

  const TREE_HIDDEN_FIELDS = new Set(["image"]);
  for (const [key, value] of Object.entries(card)) {
    if (TREE_HIDDEN_FIELDS.has(key)) continue;
    if (key === "boosts") {
      fields.appendChild(buildBoostsField(value || []));
    } else if (DICT_FIELDS.has(key) && value && typeof value === "object") {
      fields.appendChild(buildDictField(key, value));
    } else {
      fields.appendChild(buildSimpleField(key, value));
    }
  }

  if (!("boosts" in card)) {
    fields.appendChild(buildBoostsField([]));
  }

  function saveAndGoBackToTrees() {
    const cardData = collectFormData(fields, card);
    socket.emit("save_card", { card_type: cardType, index, card_data: cardData });
    editingKey = null;
    setTimeout(() => socket.emit("get_card_trees"), 300);
  }

  const backBtn = document.createElement("button");
  backBtn.className = "btn btn-sm";
  backBtn.textContent = "\u2190 Back to trees (auto-saves)";
  backBtn.addEventListener("click", saveAndGoBackToTrees);
  form.appendChild(backBtn);

  const title = document.createElement("h3");
  title.className = "tree-edit-title";
  title.textContent = `Editing: ${card.name} (ID: ${card.id ?? "\u2014"})`;
  form.appendChild(title);

  form.appendChild(fields);

  const actions = document.createElement("div");
  actions.className = "editor-form-actions";

  const saveBtn = document.createElement("button");
  saveBtn.className = "btn btn-sm btn-accent";
  saveBtn.textContent = "Save";
  saveBtn.addEventListener("click", () => {
    const cardData = collectFormData(fields, card);
    socket.emit("save_card", { card_type: cardType, index, card_data: cardData });
    editingKey = null;
    setTimeout(() => socket.emit("get_card_trees"), 300);
  });

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn btn-sm";
  cancelBtn.textContent = "Discard changes";
  cancelBtn.addEventListener("click", () => {
    socket.emit("unlock_card", { card_type: cardType, index });
    editingKey = null;
    socket.emit("get_card_trees");
  });

  actions.appendChild(saveBtn);
  actions.appendChild(cancelBtn);
  form.appendChild(actions);
  treesBody.appendChild(form);
}

// ══════════════════════════════════════════════════════════════
// ── Card Graveyard ───────────────────────────────────────────
// ══════════════════════════════════════════════════════════════

const graveyardBtn = document.getElementById("graveyard-btn");
const graveyardModal = document.getElementById("graveyard-modal");
const closeGraveyardModal = document.getElementById("close-graveyard-modal");
const graveyardBody = document.getElementById("graveyard-body");

graveyardBtn.addEventListener("click", () => {
  socket.emit("get_graveyard");
});

closeGraveyardModal.addEventListener("click", () => {
  graveyardModal.classList.add("hidden");
  editorModal.classList.remove("hidden");
});

graveyardModal.addEventListener("click", (e) => {
  if (e.target === graveyardModal) closeGraveyardModal.click();
});

socket.on("graveyard_data", (data) => {
  renderGraveyard(data.cards);
  graveyardModal.classList.remove("hidden");
});

function renderGraveyard(cards) {
  graveyardBody.innerHTML = "";

  if (!cards || cards.length === 0) {
    graveyardBody.innerHTML = '<p class="text-dim" style="padding:1rem;">The graveyard is empty. Deleted cards will appear here.</p>';
    return;
  }

  const grouped = {};
  cards.forEach((entry, idx) => {
    const ct = entry.card_type;
    if (!grouped[ct]) grouped[ct] = [];
    grouped[ct].push({ ...entry, graveyardIndex: idx });
  });

  for (const [cardType, entries] of Object.entries(grouped)) {
    const section = document.createElement("div");
    section.className = "editor-section";

    const h3 = document.createElement("h3");
    h3.className = "editor-section-title";
    h3.textContent = `${EDITOR_TYPE_LABELS[cardType] || cardType} (${entries.length})`;
    section.appendChild(h3);

    const grid = document.createElement("div");
    grid.className = "editor-grid";

    entries.forEach(entry => {
      const card = entry.card_data;
      const el = document.createElement("div");
      el.className = "editor-card graveyard-card";

      el.innerHTML = `
        <div class="editor-card-body">
          <div class="editor-card-id">ID: ${card.id ?? "\u2014"}</div>
          <div class="editor-card-name">${card.name || "Unnamed"}</div>
          <div class="editor-card-meta">
            <span class="editor-card-tag">${card.tag || ""}</span>
            <span class="editor-card-cost">Cost: ${card.cost ?? 0}</span>
          </div>
          <div class="editor-card-desc">${card.description || ""}</div>
        </div>
        <div class="graveyard-actions">
          <button class="btn btn-sm btn-accent graveyard-restore-btn">Restore</button>
          <button class="btn btn-sm btn-danger-sm graveyard-perma-btn">Delete Forever</button>
        </div>
      `;

      el.querySelector(".graveyard-restore-btn").addEventListener("click", () => {
        socket.emit("restore_card", { index: entry.graveyardIndex });
      });

      el.querySelector(".graveyard-perma-btn").addEventListener("click", () => {
        showConfirmDialog(
          `Permanently delete "${card.name || "Unnamed"}"?`,
          () => socket.emit("permanent_delete_card", { index: entry.graveyardIndex }),
          { detail: "This cannot be undone.", confirmText: "Delete Forever" }
        );
      });

      grid.appendChild(el);
    });

    section.appendChild(grid);
    graveyardBody.appendChild(section);
  }
}

// ══════════════════════════════════════════════════════════════
// ── Game Board ───────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════

const boardModal = document.getElementById("board-modal");
const closeBoardModal = document.getElementById("close-board-modal");
const boardContainer = document.getElementById("board-container");
const boardPending = document.getElementById("board-pending");
const boardInfoBar = document.getElementById("board-info-bar");
const openBoardBtn = document.getElementById("open-board-btn");

let boardTiles = [];
const HEX_SIZE = 24;
const SQRT3 = Math.sqrt(3);

const TERRAIN_COLORS = {
  empty: "#2a2d35",
  city: "#2a2d35",
  lake: "#2980b9",
  government: "#c0392b",
  industrial: "#5d4037",
  commercial: "#1565c0",
};

const TILE_COLORS = {
  power_plant: "#f1c40f",
  factory:     "#8b6914",
  data_center: "#5dade2",
  store:       "#27ae60",
  ads:         "#e056a0",
};

const TILE_LABELS = {
  power_plant:  "⚡",
  factory:      "🏭",
  data_center:  "🖥️",
  store:        "🏪",
  ad_campaign:  "📢",
  office:       "🏢",
  lobby_group:  "💻",
};

const TILE_FULL_NAMES = {
  power_plant:  "Power Plant",
  factory:      "Hardware Factory",
  data_center:  "Data Center",
  store:        "Store",
  ad_campaign:  "Ad Campaign",
  office:       "Office",
  lobby_group:  "Lobby Group",
};

const TILE_ZONE = {
  power_plant:  "industrial",
  factory:      "industrial",
  data_center:  "industrial",
  store:        "commercial",
  ad_campaign:  "commercial",
  lobby_group:  "commercial",
  office:       "commercial",
};

function canPlaceOn(tileType, terrain) {
  if (terrain === "lake" || terrain === "government" || terrain === "city") return false;
  if (terrain === "empty") return true;
  const zone = TILE_ZONE[tileType];
  return zone === terrain;
}

const CLIENT_TILE_BASE_BONUSES = {
  power_plant:  {},
  factory:      {},
  data_center:  { production: { data_centers: 1 } },
  store:        { production: { ad_campaigns: 1 } },
  ad_campaign:  { production: { ad_campaigns: 1 } },
  office:       { production: { HR: 1 } },
  lobby_group:  {},
};

function previewPlacementBonuses(tile, tileType) {
  const base = CLIENT_TILE_BASE_BONUSES[tileType] || {};
  const immediate = Object.assign({}, base.immediate || {});
  const production = Object.assign({}, base.production || {});

  const bb = tile.build_bonuses || {};
  for (const [res, amt] of Object.entries(bb.immediate || {}))
    immediate[res] = (immediate[res] || 0) + amt;
  for (const [res, amt] of Object.entries(bb.production || {}))
    production[res] = (production[res] || 0) + amt;

  const tilesByKey = {};
  boardTiles.forEach(t => { tilesByKey[`${t.row},${t.col}`] = t; });
  const dirs = tile.row & 1
    ? [[-1,1],[-1,0],[0,-1],[1,0],[1,1],[0,1]]
    : [[-1,0],[-1,-1],[0,-1],[1,-1],[1,0],[0,1]];
  for (const [dr, dc] of dirs) {
    const nb = tilesByKey[`${tile.row+dr},${tile.col+dc}`];
    if (!nb) continue;
    for (const [res, amt] of Object.entries(nb.adjacency_bonuses || {}))
      immediate[res] = (immediate[res] || 0) + amt;
    // Power plant ↔ data center synergy
    const pt = nb.placed_tile;
    if (pt) {
      if (tileType === "power_plant" && pt.type === "data_center") {
        const dcBonus = lastPrivateState?.pending_tile_meta?.dc_production_bonus ?? 1;
        production["data_centers"] = (production["data_centers"] || 0) + dcBonus;
      }
      if (tileType === "data_center" && pt.type === "power_plant")
        production["data_centers"] = (production["data_centers"] || 0) + (pt.dc_production_bonus || 1);
      if (tileType === "factory" && pt.type === "power_plant")
        immediate["money"] = (immediate["money"] || 0) + (pt.factory_refund || 0);
    }
  }

  return { immediate, production };
}

openBoardBtn.addEventListener("click", () => {
  socket.emit("get_board");
});

closeBoardModal.addEventListener("click", () => {
  boardModal.classList.add("hidden");
});

boardModal.addEventListener("click", (e) => {
  if (e.target === boardModal) boardModal.classList.add("hidden");
});

socket.on("board_state", (tiles) => {
  boardTiles = tiles;
  renderBoard();
  boardModal.classList.remove("hidden");
});

socket.on("board_update", (tiles) => {
  boardTiles = tiles;
  if (!boardModal.classList.contains("hidden")) {
    renderBoard();
  }
});

socket.on("tile_placed", (data) => {
  boardInfoBar.innerHTML = `<div class="board-placed-msg">Placed ${TILE_FULL_NAMES[data.tile_type] || data.tile_type}! Bonuses: ${data.bonuses}</div>`;
  setTimeout(() => { boardInfoBar.innerHTML = ""; }, 5000);
  renderBoard();
});

function hexCenter(row, col) {
  const x = SQRT3 * HEX_SIZE * (col + 0.5 * (row & 1));
  const y = 1.5 * HEX_SIZE * row;
  return { x, y };
}

function hexPointsStr(cx, cy) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const angle = Math.PI / 3 * i - Math.PI / 2;
    pts.push(`${cx + HEX_SIZE * Math.cos(angle)},${cy + HEX_SIZE * Math.sin(angle)}`);
  }
  return pts.join(" ");
}

function renderBoard() {
  boardContainer.innerHTML = "";

  const pending = lastPrivateState?.pending_tile;
  if (pending) {
    boardPending.classList.remove("hidden");
    boardPending.innerHTML = `
      <span class="pending-tile-icon" style="background:${TILE_COLORS[pending] || '#888'}">${TILE_LABELS[pending] || "?"}</span>
      <span>Place: <strong>${TILE_FULL_NAMES[pending] || pending}</strong></span>
    `;
  } else {
    boardPending.classList.add("hidden");
  }

  if (!boardTiles.length) return;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  boardTiles.forEach(t => {
    const { x, y } = hexCenter(t.row, t.col);
    minX = Math.min(minX, x - HEX_SIZE);
    minY = Math.min(minY, y - HEX_SIZE);
    maxX = Math.max(maxX, x + HEX_SIZE);
    maxY = Math.max(maxY, y + HEX_SIZE);
  });

  const pad = 4;
  const svgW = maxX - minX + pad * 2;
  const svgH = maxY - minY + pad * 2;
  const offX = -minX + pad;
  const offY = -minY + pad;

  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${svgW} ${svgH}`);
  svg.setAttribute("width", svgW);
  svg.setAttribute("height", svgH);
  svg.classList.add("board-svg");

  const tooltip = document.createElement("div");
  tooltip.className = "board-tooltip hidden";

  boardTiles.forEach(tile => {
    const { x: rawX, y: rawY } = hexCenter(tile.row, tile.col);
    const cx = rawX + offX;
    const cy = rawY + offY;

    const g = document.createElementNS(ns, "g");
    g.classList.add("board-hex-group");

    const poly = document.createElementNS(ns, "polygon");
    poly.setAttribute("points", hexPointsStr(cx, cy));

    let fill;
    if (tile.placed_tile) {
      const owner = lastGameState?.players?.[tile.placed_tile.owner_id];
      fill = owner?.color || TILE_COLORS[tile.placed_tile.type] || "#888";
    } else {
      fill = TERRAIN_COLORS[tile.terrain] || TERRAIN_COLORS.empty;
    }
    poly.setAttribute("fill", fill);
    poly.setAttribute("stroke", "#555");
    poly.setAttribute("stroke-width", "1.5");
    g.appendChild(poly);

    let label = "";
    let labelColor = "#fff";
    let labelSize = "7";
    if (tile.placed_tile) {
      label = TILE_LABELS[tile.placed_tile.type] || "?";
      labelSize = "12";
    } else if (tile.name) {
      label = tile.name.length > 6 ? tile.name.slice(0, 6) : tile.name;
      labelSize = tile.terrain === "lake" ? "6" : "7";
    } else if (tile.terrain === "city") {
      label = "🏙️";
      labelSize = "10";
    } else if (tile.terrain === "industrial") {
      label = "🔩";
      labelSize = "10";
    } else if (tile.terrain === "commercial") {
      label = "💼";
      labelSize = "10";
    }
    if (label) {
      const txt = document.createElementNS(ns, "text");
      txt.setAttribute("x", cx);
      txt.setAttribute("y", cy + 3);
      txt.setAttribute("text-anchor", "middle");
      txt.setAttribute("font-size", labelSize);
      txt.setAttribute("fill", labelColor);
      txt.setAttribute("font-weight", "600");
      txt.setAttribute("pointer-events", "none");
      txt.textContent = label;
      g.appendChild(txt);
    }

    const hasBuildBonus = tile.build_bonuses &&
      (Object.keys(tile.build_bonuses.immediate || {}).length ||
       Object.keys(tile.build_bonuses.production || {}).length);
    const hasAdjBonus = tile.adjacency_bonuses &&
      Object.keys(tile.adjacency_bonuses).length;
    if (hasBuildBonus || hasAdjBonus) {
      const dot = document.createElementNS(ns, "circle");
      dot.setAttribute("cx", cx + HEX_SIZE * 0.55);
      dot.setAttribute("cy", cy - HEX_SIZE * 0.55);
      dot.setAttribute("r", 3);
      dot.setAttribute("fill", hasBuildBonus ? "var(--accent)" : "#f39c12");
      dot.setAttribute("pointer-events", "none");
      g.appendChild(dot);
    }

    g.addEventListener("mouseenter", (e) => {
      let info = `<strong>(${tile.row},${tile.col})</strong>`;
      if (tile.terrain === "city") info += ` — ${tile.name || "City"} (City)`;
      else if (tile.terrain === "lake") info += ` — ${tile.name || "Lake"} (cannot build)`;
      else if (tile.terrain === "government") info += ` — ${tile.name || "Gov"} (cannot build)`;
      else if (tile.terrain === "industrial") info += ` — Industrial zone`;
      else if (tile.terrain === "commercial") info += ` — Commercial zone`;
      else if (tile.placed_tile) {
        const owner = lastGameState?.players?.[tile.placed_tile.owner_id];
        info += ` — ${TILE_FULL_NAMES[tile.placed_tile.type] || tile.placed_tile.type}`;
        if (owner) info += ` (${owner.name})`;
      } else {
        info += " — Empty";
      }

      const isPlaceable = pending && !tile.placed_tile && canPlaceOn(pending, tile.terrain);

      if (isPlaceable) {
        const preview = previewPlacementBonuses(tile, pending);
        const parts = [];
        for (const [res, amt] of Object.entries(preview.immediate))
          if (amt) parts.push(`+${amt} ${res}`);
        for (const [res, amt] of Object.entries(preview.production))
          if (amt) parts.push(`+${amt} ${res}/yr`);
        info += `<br><strong style="color:#2ecc71">▸ ${TILE_FULL_NAMES[pending]}:</strong> `;
        info += parts.length ? parts.join(", ") : "no bonuses";
      } else {
        const ab = Object.entries(tile.adjacency_bonuses || {});
        if (ab.length) info += `<br>Adj: ${ab.map(([k,v]) => `+${v} ${k}`).join(", ")}`;
        const bb = tile.build_bonuses || {};
        const bImm = Object.entries(bb.immediate || {});
        const bProd = Object.entries(bb.production || {});
        if (bImm.length || bProd.length) {
          info += `<br>Build: `;
          info += [...bImm.map(([k,v]) => `+${v} ${k}`), ...bProd.map(([k,v]) => `+${v} ${k}/yr`)].join(", ");
        }
      }

      tooltip.innerHTML = info;
      tooltip.classList.remove("hidden");
      const rect = boardContainer.getBoundingClientRect();
      const ttW = tooltip.offsetWidth || 200;
      const ttH = tooltip.offsetHeight || 40;
      let left = e.clientX - rect.left + 12;
      let top = e.clientY - rect.top - 10;
      if (left + ttW > rect.width - 8) left = e.clientX - rect.left - ttW - 12;
      if (top + ttH > rect.height - 8) top = e.clientY - rect.top - ttH - 8;
      if (left < 4) left = 4;
      if (top < 4) top = 4;
      tooltip.style.left = left + "px";
      tooltip.style.top = top + "px";
    });

    g.addEventListener("mouseleave", () => {
      tooltip.classList.add("hidden");
    });

    if (pending && !tile.placed_tile && canPlaceOn(pending, tile.terrain)) {
      poly.classList.add("board-hex-placeable");
      g.style.cursor = "pointer";
      g.addEventListener("click", () => {
        document.querySelectorAll(".board-hex-selected").forEach(el => el.classList.remove("board-hex-selected"));
        poly.classList.add("board-hex-selected");

        const preview = previewPlacementBonuses(tile, pending);
        const parts = [];
        for (const [res, amt] of Object.entries(preview.immediate))
          if (amt) parts.push(`+${amt} ${res}`);
        for (const [res, amt] of Object.entries(preview.production))
          if (amt) parts.push(`+${amt} ${res}/yr`);
        const bonusStr = parts.length ? parts.join(", ") : "no bonuses";
        showConfirmDialog(
          `Place ${TILE_FULL_NAMES[pending]} here?`,
          () => socket.emit("place_tile", { row: tile.row, col: tile.col }),
          {
            detail: `You will get: ${bonusStr}`,
            confirmText: "Place",
            onDismiss: () => poly.classList.remove("board-hex-selected"),
          }
        );
      });
    }

    svg.appendChild(g);
  });

  boardContainer.appendChild(svg);
  boardContainer.appendChild(tooltip);
}

// ══════════════════════════════════════════════════════════════
// ── Board Editor (master / editors only) ─────────────────────
// ══════════════════════════════════════════════════════════════

const boardEditorModal = document.getElementById("board-editor-modal");
const closeBoardEditor = document.getElementById("close-board-editor");
const boardEditorContainer = document.getElementById("board-editor-container");
const boardTileForm = document.getElementById("board-tile-form");
const boardEditorTitle = document.getElementById("board-editor-title");
const editBoardBtn = document.getElementById("edit-board-btn");
const editBoardLobbyBtn = document.getElementById("edit-board-lobby-btn");

let editorBoardTiles = [];
let selectedEditorTile = null;

editBoardBtn.addEventListener("click", () => socket.emit("get_board_editor"));
editBoardLobbyBtn.addEventListener("click", () => socket.emit("get_board_editor"));

closeBoardEditor.addEventListener("click", () => {
  boardEditorModal.classList.add("hidden");
  boardTileForm.classList.add("hidden");
  selectedEditorTile = null;
});

boardEditorModal.addEventListener("click", (e) => {
  if (e.target === boardEditorModal) closeBoardEditor.click();
});

socket.on("board_editor_data", (tiles) => {
  editorBoardTiles = tiles;
  renderBoardEditor();
  boardEditorModal.classList.remove("hidden");
});

function renderBoardEditor() {
  boardEditorContainer.innerHTML = "";
  boardEditorTitle.textContent = "Board Editor";

  if (!editorBoardTiles.length) return;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  editorBoardTiles.forEach(t => {
    const { x, y } = hexCenter(t.row, t.col);
    minX = Math.min(minX, x - HEX_SIZE);
    minY = Math.min(minY, y - HEX_SIZE);
    maxX = Math.max(maxX, x + HEX_SIZE);
    maxY = Math.max(maxY, y + HEX_SIZE);
  });

  const pad = 4;
  const svgW = maxX - minX + pad * 2;
  const svgH = maxY - minY + pad * 2;
  const offX = -minX + pad;
  const offY = -minY + pad;

  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${svgW} ${svgH}`);
  svg.setAttribute("width", svgW);
  svg.setAttribute("height", svgH);
  svg.classList.add("board-svg");

  const tooltip = document.createElement("div");
  tooltip.className = "board-tooltip hidden";

  editorBoardTiles.forEach(tile => {
    const { x: rawX, y: rawY } = hexCenter(tile.row, tile.col);
    const cx = rawX + offX;
    const cy = rawY + offY;

    const g = document.createElementNS(ns, "g");
    g.classList.add("board-hex-group");

    const poly = document.createElementNS(ns, "polygon");
    poly.setAttribute("points", hexPointsStr(cx, cy));

    let fill;
    if (tile.placed_tile) {
      fill = TILE_COLORS[tile.placed_tile.type] || "#888";
    } else {
      fill = TERRAIN_COLORS[tile.terrain] || TERRAIN_COLORS.empty;
    }
    poly.setAttribute("fill", fill);
    poly.setAttribute("stroke", selectedEditorTile &&
      selectedEditorTile.row === tile.row && selectedEditorTile.col === tile.col
      ? "var(--accent)" : "#555");
    poly.setAttribute("stroke-width", selectedEditorTile &&
      selectedEditorTile.row === tile.row && selectedEditorTile.col === tile.col
      ? "3" : "1.5");
    g.appendChild(poly);

    let label = "";
    let edLabelSize = "7";
    if (tile.placed_tile) {
      label = TILE_LABELS[tile.placed_tile.type] || "?";
      edLabelSize = "12";
    } else if (tile.name) {
      label = tile.name.length > 8 ? tile.name.slice(0, 8) : tile.name;
    } else if (tile.terrain === "city") {
      label = "🏙️"; edLabelSize = "10";
    } else if (tile.terrain === "industrial") {
      label = "🔩"; edLabelSize = "10";
    } else if (tile.terrain === "commercial") {
      label = "💼"; edLabelSize = "10";
    }
    if (label) {
      const txt = document.createElementNS(ns, "text");
      txt.setAttribute("x", cx);
      txt.setAttribute("y", cy + 3);
      txt.setAttribute("text-anchor", "middle");
      txt.setAttribute("font-size", edLabelSize);
      txt.setAttribute("fill", "#fff");
      txt.setAttribute("font-weight", "600");
      txt.setAttribute("pointer-events", "none");
      txt.textContent = label;
      g.appendChild(txt);
    }

    const hasBuildBonus = tile.build_bonuses &&
      (Object.keys(tile.build_bonuses.immediate || {}).length ||
       Object.keys(tile.build_bonuses.production || {}).length);
    const hasAdjBonus = tile.adjacency_bonuses &&
      Object.keys(tile.adjacency_bonuses).length;
    if (hasBuildBonus || hasAdjBonus) {
      const dot = document.createElementNS(ns, "circle");
      dot.setAttribute("cx", cx + HEX_SIZE * 0.55);
      dot.setAttribute("cy", cy - HEX_SIZE * 0.55);
      dot.setAttribute("r", 3);
      dot.setAttribute("fill", hasBuildBonus ? "var(--accent)" : "#f39c12");
      dot.setAttribute("pointer-events", "none");
      g.appendChild(dot);
    }

    g.addEventListener("mouseenter", (e) => {
      let info = `<strong>(${tile.row},${tile.col})</strong> — ${tile.terrain}`;
      if (tile.name) info += `: ${tile.name}`;
      const bb = tile.build_bonuses || {};
      const bImm = Object.entries(bb.immediate || {});
      const bProd = Object.entries(bb.production || {});
      if (bImm.length || bProd.length) {
        info += `<br>Build: `;
        info += [...bImm.map(([k,v]) => `+${v} ${k}`), ...bProd.map(([k,v]) => `+${v} ${k}/yr`)].join(", ");
      }
      const ab = Object.entries(tile.adjacency_bonuses || {});
      if (ab.length) {
        info += `<br>Adj: ${ab.map(([k,v]) => `+${v} ${k}`).join(", ")}`;
      }
      tooltip.innerHTML = info;
      tooltip.classList.remove("hidden");
      const rect = boardEditorContainer.getBoundingClientRect();
      tooltip.style.left = (e.clientX - rect.left + 12) + "px";
      tooltip.style.top = (e.clientY - rect.top - 10) + "px";
    });

    g.addEventListener("mouseleave", () => tooltip.classList.add("hidden"));

    g.style.cursor = "pointer";
    g.addEventListener("click", () => {
      selectedEditorTile = tile;
      renderBoardEditor();
      renderBoardTileForm(tile);
    });

    svg.appendChild(g);
  });

  boardEditorContainer.appendChild(svg);
  boardEditorContainer.appendChild(tooltip);
}

function _boardInput(value, placeholder) {
  const inp = document.createElement("input");
  inp.type = "text";
  inp.value = value;
  inp.placeholder = placeholder || "";
  inp.className = "board-form-input";
  return inp;
}

function _boardResRow(key, value) {
  const row = document.createElement("div");
  row.className = "board-res-row";

  const sel = document.createElement("select");
  sel.className = "editor-dict-key";
  RESOURCE_OPTIONS.forEach(r => {
    const o = document.createElement("option");
    o.value = r; o.textContent = r;
    if (r === key) o.selected = true;
    sel.appendChild(o);
  });
  row.appendChild(sel);

  const inp = document.createElement("input");
  inp.type = "number";
  inp.value = value;
  inp.className = "board-form-input";
  inp.style.width = "60px";
  row.appendChild(makeNumSpinner(inp, { min: 0 }));

  const del = document.createElement("button");
  del.className = "btn btn-sm btn-danger-sm";
  del.textContent = "×";
  del.style.padding = "0 .4rem";
  del.addEventListener("click", () => row.remove());
  row.appendChild(del);

  return row;
}

function _collectResRows(container) {
  const result = {};
  container.querySelectorAll(".board-res-row").forEach(row => {
    const sel = row.querySelector("select");
    const inp = row.querySelector('input[type="number"]');
    const k = sel ? sel.value : "";
    const v = inp ? parseInt(inp.value, 10) || 0 : 0;
    if (k && v) result[k] = v;
  });
  return result;
}

function renderBoardTileForm(tile) {
  boardTileForm.classList.remove("hidden");
  boardTileForm.innerHTML = "";

  const title = document.createElement("h3");
  title.textContent = `Editing tile (${tile.row}, ${tile.col})`;
  title.style.marginBottom = ".8rem";
  boardTileForm.appendChild(title);

  const form = document.createElement("div");
  form.className = "editor-fields";

  // --- Terrain select ---
  const terrainRow = document.createElement("div");
  terrainRow.className = "editor-field";
  const terrainLabel = document.createElement("label");
  terrainLabel.textContent = "Terrain type";
  terrainRow.appendChild(terrainLabel);
  const terrainSelect = document.createElement("select");
  terrainSelect.className = "editor-dict-key";
  terrainSelect.style.width = "100%";
  ["empty", "city", "lake", "government", "industrial", "commercial"].forEach(t => {
    const o = document.createElement("option");
    o.value = t;
    o.textContent = t.charAt(0).toUpperCase() + t.slice(1);
    if (t === tile.terrain) o.selected = true;
    terrainSelect.appendChild(o);
  });
  terrainRow.appendChild(terrainSelect);
  form.appendChild(terrainRow);

  // --- Name ---
  const nameRow = document.createElement("div");
  nameRow.className = "editor-field";
  const nameLabel = document.createElement("label");
  nameLabel.textContent = "Name / Label";
  nameRow.appendChild(nameLabel);
  const nameInput = _boardInput(tile.name || "", 'e.g. "New York"');
  nameRow.appendChild(nameInput);
  form.appendChild(nameRow);

  // --- Build bonuses (for buildable tiles) ---
  const buildSection = document.createElement("div");
  buildSection.className = "editor-field board-bonus-section";
  const buildTitle = document.createElement("label");
  buildTitle.textContent = "Build bonuses (what a player gets when building here)";
  buildSection.appendChild(buildTitle);

  const buildImmLabel = document.createElement("span");
  buildImmLabel.className = "board-bonus-sub";
  buildImmLabel.textContent = "Immediate";
  buildSection.appendChild(buildImmLabel);
  const buildImmContainer = document.createElement("div");
  buildImmContainer.className = "board-res-container";
  const bb = tile.build_bonuses || {};
  Object.entries(bb.immediate || {}).forEach(([k, v]) => {
    buildImmContainer.appendChild(_boardResRow(k, v));
  });
  const addBuildImm = document.createElement("button");
  addBuildImm.className = "btn btn-sm";
  addBuildImm.textContent = "+ Add";
  addBuildImm.addEventListener("click", () => {
    buildImmContainer.insertBefore(_boardResRow("", 0), addBuildImm);
  });
  buildImmContainer.appendChild(addBuildImm);
  buildSection.appendChild(buildImmContainer);
  form.appendChild(buildSection);

  // --- Adjacency bonuses (for any terrain, but mainly lake/gov) ---
  const adjSection = document.createElement("div");
  adjSection.className = "editor-field board-bonus-section";
  const adjTitle = document.createElement("label");
  adjTitle.textContent = "Adjacency bonuses (given to players building next to this tile)";
  adjSection.appendChild(adjTitle);
  const adjContainer = document.createElement("div");
  adjContainer.className = "board-res-container";
  Object.entries(tile.adjacency_bonuses || {}).forEach(([k, v]) => {
    adjContainer.appendChild(_boardResRow(k, v));
  });
  const addAdj = document.createElement("button");
  addAdj.className = "btn btn-sm";
  addAdj.textContent = "+ Add";
  addAdj.addEventListener("click", () => {
    adjContainer.insertBefore(_boardResRow("", 0), addAdj);
  });
  adjContainer.appendChild(addAdj);
  adjSection.appendChild(adjContainer);
  form.appendChild(adjSection);

  // --- Hint ---
  const hint = document.createElement("p");
  hint.style.fontSize = ".75rem";
  hint.style.color = "var(--text-dim)";
  hint.style.margin = ".5rem 0";
  hint.innerHTML = "<strong>Empty/City</strong> = buildable | <strong>Lake/Government</strong> = not buildable";
  form.appendChild(hint);

  boardTileForm.appendChild(form);

  // --- Add tile left/right/top/bottom ---
  const MAX_BOARD_ROWS = 10;
  const existingCoords = new Set(editorBoardTiles.map(t => `${t.row},${t.col}`));
  const has = (r, c) => existingCoords.has(`${r},${c}`);

  const isOdd = tile.row % 2 === 1;
  const topRight = isOdd ? [tile.row - 1, tile.col + 1] : [tile.row - 1, tile.col];
  const topLeft  = isOdd ? [tile.row - 1, tile.col]     : [tile.row - 1, tile.col - 1];
  const botRight = isOdd ? [tile.row + 1, tile.col + 1] : [tile.row + 1, tile.col];
  const botLeft  = isOdd ? [tile.row + 1, tile.col]     : [tile.row + 1, tile.col - 1];

  const addOptions = [];
  // Left / Right
  if (!has(tile.row, tile.col - 1))
    addOptions.push({ label: "← Left", row: tile.row, col: tile.col - 1 });
  if (!has(tile.row, tile.col + 1))
    addOptions.push({ label: "→ Right", row: tile.row, col: tile.col + 1 });
  // Top: prefer top-right, fallback top-left
  if (tile.row - 1 >= 0) {
    if (!has(...topRight))
      addOptions.push({ label: "↗ Top", row: topRight[0], col: topRight[1] });
    else if (!has(...topLeft))
      addOptions.push({ label: "↖ Top", row: topLeft[0], col: topLeft[1] });
  }
  // Bottom: prefer bottom-right, fallback bottom-left
  if (tile.row + 1 < MAX_BOARD_ROWS) {
    if (!has(...botRight))
      addOptions.push({ label: "↘ Bottom", row: botRight[0], col: botRight[1] });
    else if (!has(...botLeft))
      addOptions.push({ label: "↙ Bottom", row: botLeft[0], col: botLeft[1] });
  }

  if (addOptions.length) {
    const addTileBar = document.createElement("div");
    addTileBar.className = "editor-form-actions";
    addTileBar.style.cssText = "border-top:1px solid var(--border);padding-top:.6rem;margin-top:.4rem;flex-wrap:wrap;";

    const addLabel = document.createElement("span");
    addLabel.style.cssText = "font-size:.8rem;color:var(--text-dim);width:100%;margin-bottom:.3rem;";
    addLabel.textContent = "Add new tile:";
    addTileBar.appendChild(addLabel);

    for (const opt of addOptions) {
      const btn = document.createElement("button");
      btn.className = "btn btn-sm";
      btn.textContent = opt.label;
      btn.addEventListener("click", () => {
        socket.emit("add_board_tile", { row: opt.row, col: opt.col });
      });
      addTileBar.appendChild(btn);
    }
    boardTileForm.appendChild(addTileBar);
  }

  // --- Actions ---
  const actions = document.createElement("div");
  actions.className = "editor-form-actions";

  const saveBtn = document.createElement("button");
  saveBtn.className = "btn btn-sm btn-accent";
  saveBtn.textContent = "Save";
  saveBtn.addEventListener("click", () => {
    const buildBonuses = {
      immediate: _collectResRows(buildImmContainer),
      production: {},
    };
    const adjacencyBonuses = _collectResRows(adjContainer);
    socket.emit("edit_board_tile", {
      row: tile.row,
      col: tile.col,
      terrain: terrainSelect.value,
      name: nameInput.value.trim(),
      build_bonuses: buildBonuses,
      adjacency_bonuses: adjacencyBonuses,
    });
    selectedEditorTile = null;
    boardTileForm.classList.add("hidden");
  });

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn btn-sm";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => {
    selectedEditorTile = null;
    boardTileForm.classList.add("hidden");
    renderBoardEditor();
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "btn btn-sm btn-danger-sm";
  deleteBtn.textContent = "Delete Tile";
  deleteBtn.addEventListener("click", () => {
    const label = tile.name ? `"${tile.name}" at` : "";
    showConfirmDialog(
      `Delete tile ${label} (${tile.row}, ${tile.col})?`,
      () => {
        socket.emit("remove_board_tile", { row: tile.row, col: tile.col });
        selectedEditorTile = null;
        boardTileForm.classList.add("hidden");
      },
      { detail: "This removes it from the board.", confirmText: "Delete" }
    );
  });

  actions.appendChild(saveBtn);
  actions.appendChild(cancelBtn);
  actions.appendChild(deleteBtn);
  boardTileForm.appendChild(actions);

  requestAnimationFrame(() => {
    boardTileForm.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
}

