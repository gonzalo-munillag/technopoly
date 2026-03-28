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
  regulation: "Events",
  player_turns: "Turns",
  year_end: "Year End",
};

const CARD_TYPE_GROUPS = [
  { key: "company", label: "Company" },
  { key: "platform", label: "Platform" },
  { key: "cyber_attack", label: "Cyber Warfare" },
  { key: "innovation", label: "Innovation" },
  { key: "leverage", label: "Leverage" },
  { key: "fuck_up", label: "Fuck-ups" },
  { key: "build", label: "Build" },
  { key: "regulation", label: "Events — Regulation" },
  { key: "world_event", label: "Events — World Events" },
];

const DRAFT_SECTIONS = [
  { deck: "projects", label: "Projects", types: ["platform", "cyber_attack"] },
  { deck: "boosters", label: "Boosters", types: ["leverage", "innovation"] },
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
  if (!boardModal.classList.contains("hidden")) {
    renderBuildRow();
  }
});

socket.on("your_state", (data) => {
  const hadPending = lastPrivateState?.pending_tile;
  lastPrivateState = data;
  renderResources(data.resources);
  renderProduction(data.production);
  renderUsersPie();
  renderHand(data.hand);
  renderDraft(data.draft_pool, data.drafted_fuckups);
  // Re-render hand modal live if it's open (e.g. after a tier purchase)
  if (!handModal.classList.contains("hidden")) renderHandModal();
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
  if (!boardModal.classList.contains("hidden")) {
    renderBuildRow();
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
    const iWentToCourt = lastPrivateState.went_to_court || myWentToCourt;
    if (allResolved) {
      regulationWaiting.classList.add("hidden");
      if (iWentToCourt && !dieRolling) {
        regStartYearBtn.classList.remove("hidden");
      }
      // else: acceptance player waits silently, or die still spinning
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

socket.on("player_bankrupt", (data) => {
  document.querySelector(".bankrupt-overlay")?.remove();
  const overlay = document.createElement("div");
  overlay.className = "confirm-dialog-overlay bankrupt-overlay";
  const box = document.createElement("div");
  box.className = "confirm-dialog";
  box.style.textAlign = "center";
  box.innerHTML = `
    <div style="font-size:1.3em;color:var(--danger);margin-bottom:.5rem">💸 BANKRUPTCY</div>
    <div style="margin-bottom:.8rem">
      <strong style="color:var(--accent)">${data.player_name}</strong> has been driven into bankruptcy
      by negative money production and has been eliminated from the game.
    </div>
  `;
  const btn = document.createElement("button");
  btn.className = "btn btn-sm btn-accent";
  btn.textContent = "Noted";
  btn.addEventListener("click", () => overlay.remove());
  box.appendChild(btn);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
});

socket.on("game_won", (data) => {
  document.querySelector(".game-won-overlay")?.remove();

  const scores = Object.entries(data.scores || {})
    .sort(([,a],[,b]) => b - a)
    .map(([name, u]) => `<span style="color:var(--text)">${name}:</span> <strong>${u}M 👥</strong>`)
    .join("<br>");

  const overlay = document.createElement("div");
  overlay.className = "confirm-dialog-overlay game-won-overlay";

  const box = document.createElement("div");
  box.className = "confirm-dialog";
  box.style.maxWidth = "480px";
  box.style.textAlign = "center";

  box.innerHTML = `
    <div style="font-size:1.5em;color:var(--accent);margin-bottom:.6rem;letter-spacing:.05em">
      🌐 WORLD DOMINATION COMPLETE
    </div>
    <div style="font-size:1.1em;margin-bottom:.5rem">
      Technofeudalist <strong style="color:var(--accent)">${data.winner_name}</strong> has won capitalism!
    </div>
    <div style="font-size:.88em;color:var(--text-dim);font-style:italic;margin-bottom:1rem;line-height:1.6">
      Congratulations on your world domination endeavor.<br>Bend the planet to your will!
    </div>
    <div style="font-size:.82em;border-top:1px solid var(--border);padding-top:.8rem;line-height:1.8">
      ${scores}
    </div>
  `;

  const closeBtn = document.createElement("button");
  closeBtn.className = "btn btn-sm btn-accent";
  closeBtn.textContent = "Hail the Technofeudalist";
  closeBtn.style.marginTop = "1rem";
  closeBtn.addEventListener("click", () => overlay.remove());
  box.appendChild(closeBtn);

  overlay.appendChild(box);
  document.body.appendChild(overlay);
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
    // Clear dirty flag when entering hiring phase so dials start fresh each year
    if (lastGameState?.phase !== "hiring") {
      const hireEng = document.getElementById("hire-engineers");
      const hireSuit = document.getElementById("hire-suits");
      if (hireEng) delete hireEng.dataset.dirty;
      if (hireSuit) delete hireSuit.dataset.dirty;
    }
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
      keepBtn.textContent = `Keep ($${draftCost}M)`;
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
  // Only reset dials if the player hasn't touched them yet (data-dirty not set).
  // This prevents another player's submission from wiping a player's own choices.
  if (!hireEng.dataset.dirty) hireEng.value = 0;
  if (!hireSuit.dataset.dirty) hireSuit.value = 0;
  const markDirty = () => {
    hireEng.dataset.dirty = "1";
    hireSuit.dataset.dirty = "1";
  };
  hireEng.addEventListener("input", markDirty, { once: true });
  hireSuit.addEventListener("input", markDirty, { once: true });
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
  const hireEng = document.getElementById("hire-engineers");
  const hireSuit = document.getElementById("hire-suits");
  const eng = parseInt(hireEng.value) || 0;
  const suits = parseInt(hireSuit.value) || 0;
  // Clear dirty flag so next year's dials start at 0
  delete hireEng.dataset.dirty;
  delete hireSuit.dataset.dirty;
  socket.emit("submit_hiring", { engineers: eng, suits });
});

// ── Events (Regulation / World Event) ───────────────────────
function renderRegulation(card) {
  if (!card) {
    regulationDisplay.innerHTML = `<p class="text-dim">No event card this year.</p>`;
    return;
  }
  regulationDisplay.innerHTML = "";
  const el = createCardElement(card);
  const compText = Object.entries(card.compliance || card.penalty || {})
    .map(([k, v]) => `${v > 0 ? "+" : ""}${fmtCardVal(k, v)} ${emojiRes(k)}`)
    .join(", ");
  const courtText = Object.entries(card.court_penalty || {})
    .map(([k, v]) => `${v > 0 ? "+" : ""}${fmtCardVal(k, v)} ${emojiRes(k)}`)
    .join(", ");
  const threshold = card.court_threshold || 4;
  const winPct = Math.round(((7 - threshold) / 6) * 100);
  const losePct = 100 - winPct;
  let infoHtml = "";
  if (compText) infoHtml += `<p class="reg-compliance-text"><strong>Compliance:</strong> ${compText}</p>`;
  if (courtText) infoHtml += `<p class="reg-court-text"><strong>Court penalty:</strong> ${courtText}</p>`;
  infoHtml += `<p class="reg-court-text"><strong>Court odds:</strong> ${winPct}% win / ${losePct}% lose (<span class="court-threshold">&ge; ${threshold}</span> on a die roll to win)</p>`;
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
      .map(([k, v]) => `${v > 0 ? "+" : ""}${fmtCardVal(k, v)} ${emojiRes(k)}`).join(", ");
    const courtText = Object.entries(data.court_penalty)
      .map(([k, v]) => `${v > 0 ? "+" : ""}${fmtCardVal(k, v)} ${emojiRes(k)}`).join(", ");
    const winPct = Math.round(((7 - data.court_threshold) / 6) * 100);
    const losePct = 100 - winPct;
    const targeted = (data.targeted_cards || []).map(c => c.name).join(", ");
    const isWorldEvent = data.card_type === "world_event";
    let html = `<p><strong>${isWorldEvent ? "🌍 This world event" : "⚖️ This regulation"} affects you!</strong></p>`;
    if (targeted) html += `<p>Targeted card(s): <strong>${targeted}</strong> — accepting means losing them.</p>`;
    html += `<p class="reg-compliance-text">Accept compliance: ${compText}</p>`;
    html += `<p class="reg-court-text">Court loss penalty: ${courtText} — ${losePct}% chance of losing (<span class="court-threshold">&ge; ${data.court_threshold}</span> on a die roll to win)</p>`;
    if (targeted) html += `<p class="reg-compliance-text">Win in court (${winPct}%): keep your card(s), no penalty.</p>`;
    regulationAlertBox.innerHTML = html;
    regulationAlertBox.classList.remove("hidden");
    regulationActions.classList.remove("hidden");
    regulationResultBox.classList.add("hidden");
    regulationWaiting.classList.add("hidden");
    regProceedBtn.classList.add("hidden");
  } else {
    const nobodyAffected = !data.any_affected;
    const eventWord = data.card_type === "world_event" ? "world event" : "regulation";
    regulationAlertBox.innerHTML = nobodyAffected
      ? `<p>No players are affected by this ${eventWord}.</p>`
      : `<p>This ${eventWord} does not affect you.</p>`;
    regulationAlertBox.classList.remove("hidden");
    regulationActions.classList.add("hidden");
    regulationResultBox.classList.add("hidden");
    regulationWaiting.classList.add("hidden");
    regProceedBtn.classList.remove("hidden");
  }
});

const dieContainer = document.getElementById("die-container");
const dieFace = document.getElementById("die-face");
const DIE_FACES = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
let dieRolling = false;
let pendingCourtResult = null;
let pendingStartYearBtn = false;  // show Start Year after die finishes

function startDieRoll() {
  dieContainer.classList.remove("hidden");
  dieFace.classList.add("rolling");
  dieFace.textContent = "🎲";
  dieRolling = true;
  pendingCourtResult = null;
  let ticks = 0;
  const total = 20; // 3 000 ms / 150 ms
  const iv = setInterval(() => {
    dieFace.textContent = DIE_FACES[Math.floor(Math.random() * 6)];
    ticks++;
    if (ticks >= total) {
      clearInterval(iv);
      dieFace.classList.remove("rolling");
      dieRolling = false;
      if (pendingCourtResult) {
        applyCourtDieResult(pendingCourtResult);
        pendingCourtResult = null;
      }
      // Show Start Year button if it was deferred while die was rolling
      if (pendingStartYearBtn) {
        pendingStartYearBtn = false;
        regStartYearBtn.classList.remove("hidden");
      }
    }
  }, 150);
}

function applyCourtDieResult(data) {
  // Show final die face
  if (data.roll >= 1 && data.roll <= 6) {
    dieFace.textContent = DIE_FACES[data.roll - 1];
  }
  applyRegulationResult(data);
}

function applyRegulationResult(data) {
  regulationActions.classList.add("hidden");
  regulationResultBox.classList.remove("hidden");
  regStartYearBtn.classList.add("hidden");
  const lostCards = (data.lost_cards || []);
  const lostMsg = lostCards.length ? `<p>Lost card(s): <strong>${lostCards.join(", ")}</strong></p>` : "";
  if (data.action === "accept") {
    myWentToCourt = false;
    const compText = Object.entries(data.compliance || data.penalty || {})
      .map(([k, v]) => `${v > 0 ? "+" : ""}${fmtCardVal(k, v)} ${emojiRes(k)}`).join(", ");
    regulationResultBox.innerHTML = `<p>You accepted the compliance: ${compText || "no penalty"}</p>${lostMsg}`;
    regulationWaiting.textContent = "Waiting for others to resolve their compliance...";
    regulationWaiting.classList.remove("hidden");
  } else {
    myWentToCourt = true;
    const result = data.won ? "Won" : "Lost";
    let msg = `<p>Court roll: <strong>${data.roll}</strong> (needed <span class="court-threshold">&ge; ${data.threshold}</span>) — <strong>${result}!</strong></p>`;
    if (!data.won) {
      const courtText = Object.entries(data.penalty || {})
        .map(([k, v]) => `${v > 0 ? "+" : ""}${fmtCardVal(k, v)} ${emojiRes(k)}`).join(", ");
      msg += `<p>Court penalty applied: ${courtText}</p>${lostMsg}`;
    } else {
      msg += `<p>No penalty — you beat the case and keep your cards!</p>`;
    }
    regulationResultBox.innerHTML = msg;
    regulationWaiting.textContent = "Waiting for all court players to start the year...";
    regulationWaiting.classList.remove("hidden");
  }
  regProceedBtn.classList.add("hidden");
}

regAcceptBtn.addEventListener("click", () => socket.emit("regulation_accept"));
regCourtBtn.addEventListener("click", () => {
  startDieRoll();
  socket.emit("regulation_court");
});
regProceedBtn.addEventListener("click", () => {
  socket.emit("proceed_regulation");
  regProceedBtn.classList.add("hidden");
  regulationWaiting.textContent = "Waiting for others to resolve their compliance...";
  regulationWaiting.classList.remove("hidden");
});

let myWentToCourt = false;

socket.on("regulation_result", (data) => {
  if (data.action === "court" && dieRolling) {
    // Die still spinning — buffer result, show after animation ends
    pendingCourtResult = data;
  } else if (data.action === "court") {
    applyCourtDieResult(data);
  } else {
    // Accepted compliance — no die needed
    dieContainer.classList.add("hidden");
    applyRegulationResult(data);
  }
});

socket.on("regulation_all_resolved", (data) => {
  regulationWaiting.classList.add("hidden");
  // If the die is still rolling we KNOW this player went to court (die only spins during court).
  // myWentToCourt may not be set yet because applyRegulationResult hasn't run — defer.
  if (dieRolling) {
    pendingStartYearBtn = true;
    return;
  }
  // Only court players get the Start Year button
  if (myWentToCourt) {
    regStartYearBtn.classList.remove("hidden");
  } else {
    regulationWaiting.textContent = "Waiting for court players to start the year...";
    regulationWaiting.classList.remove("hidden");
  }
});

regStartYearBtn.addEventListener("click", () => {
  socket.emit("start_year_after_regulation");
  regStartYearBtn.classList.add("hidden");
  regulationWaiting.textContent = "Waiting for other court players to start the year...";
  regulationWaiting.classList.remove("hidden");
});

// ── Hand (player turns) ────────────────────────────────────
function canAffordCard(card) {
  const resources = lastPrivateState?.resources || {};
  const costs = card.costs || {};
  const COST_SKIP = new Set(["fee", "fee_card_id", "fee_card_type", "fee_company_type", "payee_card_id"]);
  let totalMoney = 0;

  if (Object.keys(costs).length === 0) {
    totalMoney = card.cost || 0;
  } else {
    for (const [res, amt] of Object.entries(costs)) {
      if (!amt || COST_SKIP.has(res)) continue;
      if (res === "money") { totalMoney += amt; continue; }
      if ((resources[res] ?? 0) < amt) return false;
    }
  }
  if (costs.fee && !iOwnFeeCosts(costs)) {
    totalMoney += costs.fee;
  }
  return totalMoney <= (resources.money ?? 0);
}

/**
 * Return a list of {pid, name} for players (other than me) who are eligible
 * to receive the fee defined by the costs object:
 *   fee_card_id     → players who have played that specific card
 *   fee_card_type   → players who have played any card of that type
 *   fee_company_type→ players whose chosen company is of that type
 */
function findPayeesForFee(costs) {
  if (!costs || !lastGameState) return [];
  const results = [];
  for (const [pid, p] of Object.entries(lastGameState.players)) {
    if (pid === myPlayerId) continue;
    let eligible = false;
    if (costs.fee_card_id) {
      const targetId = Number(costs.fee_card_id);
      eligible = (p.played_cards || []).some(c => Number(c.id) === targetId);
    } else if (costs.fee_card_type) {
      eligible = (p.played_cards || []).some(c => c.card_color_type === costs.fee_card_type);
    } else if (costs.fee_company_type) {
      eligible = !!(p.company && p.company.card_color_type === costs.fee_company_type);
    }
    if (eligible) results.push({ pid, name: p.name });
  }
  return results;
}

/** True if the current player "owns" the fee target (fee is waived for them). */
function iOwnFeeCosts(costs) {
  if (!costs || !lastGameState) return false;
  const me = lastGameState.players[myPlayerId];
  if (!me) return false;
  if (costs.fee_card_id) {
    const targetId = Number(costs.fee_card_id);
    return (me.played_cards || []).some(c => Number(c.id) === targetId);
  }
  if (costs.fee_card_type) {
    return (me.played_cards || []).some(c => c.card_color_type === costs.fee_card_type);
  }
  if (costs.fee_company_type) {
    return !!(me.company && me.company.card_color_type === costs.fee_company_type);
  }
  return false;
}

/** Legacy shim — kept so any remaining call sites work. */
function iOwnFeeCard(feeCardId) {
  if (!feeCardId || !lastGameState) return false;
  const targetId = Number(feeCardId);
  const me = lastGameState.players[myPlayerId];
  return (me?.played_cards || []).some(c => Number(c.id) === targetId);
}

function showPaymentPopup(card, useOptional, callback) {
  const cardCosts = card.costs || {};
  const hasFee = cardCosts.fee && (
    cardCosts.fee_card_id || cardCosts.fee_card_type || cardCosts.fee_company_type
  );

  // Fee waived — player already owns the fee target
  if (hasFee && iOwnFeeCosts(cardCosts)) {
    callback({});
    return;
  }

  // No fee at all — play immediately
  if (!hasFee) { callback({}); return; }

  const feePayees = findPayeesForFee(cardCosts);
  const feeAmt = cardCosts.fee;
  // Human-readable description of who triggers the fee
  let feeCardName;
  if (cardCosts.fee_card_id) {
    feeCardName = cardNameById(cardCosts.fee_card_id);
  } else if (cardCosts.fee_card_type) {
    feeCardName = `any "${cardCosts.fee_card_type}" card`;
  } else {
    feeCardName = `a "${cardCosts.fee_company_type}" company`;
  }

  const overlay = document.createElement("div");
  overlay.className = "payment-popup-overlay";
  const popup = document.createElement("div");
  popup.className = "payment-popup";

  const title = document.createElement("h3");
  title.textContent = "Fee Payment";
  popup.appendChild(title);

  if (feePayees.length === 0) {
    // No one has the fee card — fee goes to the bank
    const info = document.createElement("p");
    info.className = "payment-info";
    info.innerHTML = `No player has played <em>${feeCardName}</em> yet.<br>
      Your fee of <strong>💰$${feeAmt}M</strong> goes to the <strong>bank</strong> (no one receives it).`;
    popup.appendChild(info);

    const actions = document.createElement("div");
    actions.className = "payment-actions";
    const confirmBtn = document.createElement("button");
    confirmBtn.className = "btn btn-sm btn-accent";
    confirmBtn.textContent = "Pay to Bank & Play";
    confirmBtn.addEventListener("click", () => { overlay.remove(); callback({}); });
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "btn btn-sm";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => overlay.remove());
    actions.appendChild(confirmBtn);
    actions.appendChild(cancelBtn);
    popup.appendChild(actions);

  } else {
    // One or more payees — player clicks a name button to pay and play
    const info = document.createElement("p");
    info.className = "payment-info";
    info.innerHTML = feePayees.length === 1
      ? `You owe <strong>💰$${feeAmt}M</strong> for <em>${feeCardName}</em>.<br>Click the player below to pay and play:`
      : `You owe <strong>💰$${feeAmt}M</strong> for <em>${feeCardName}</em>.<br>Choose who receives the fee:`;
    popup.appendChild(info);

    const btnRow = document.createElement("div");
    btnRow.className = "payment-player-btns";
    feePayees.forEach(({ pid, name }) => {
      const btn = document.createElement("button");
      btn.className = "btn btn-sm payment-player-btn";
      btn.textContent = `💰 Pay ${name}`;
      btn.addEventListener("click", () => { overlay.remove(); callback({ fee: pid }); });
      btnRow.appendChild(btn);
    });
    popup.appendChild(btnRow);

    const actions = document.createElement("div");
    actions.className = "payment-actions";
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "btn btn-sm";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => overlay.remove());
    actions.appendChild(cancelBtn);
    popup.appendChild(actions);
  }

  overlay.appendChild(popup);
  document.body.appendChild(overlay);
}

function renderHand(hand) {
  handDiv.innerHTML = "";
  hand.forEach(card => {
    const el = createCardElement(card, { interactive: true });
    const costs = card.costs || {};
    const hasFee = costs.fee && (costs.fee_card_id || costs.fee_card_type || costs.fee_company_type);
    const rm = card.responsible_mining;

    // Responsible-mining toggle for rare metal mine cards
    let responsibleMining = false;
    if (rm && Object.keys(rm).length) {
      const rmBar = document.createElement("div");
      rmBar.className = "card-rm-bar";

      const rmToggle = document.createElement("button");
      rmToggle.className = "btn btn-sm card-rm-btn";
      const extraCost = rm.extra_cost ? Object.entries(rm.extra_cost).map(([k,v]) => `+$${v}B`).join(", ") : "";
      const extraEffect = rm.extra_effect ? Object.entries(rm.extra_effect).map(([k,v]) => `+${v} ${k}`).join(", ") : "";
      const updateRmBtn = () => {
        rmToggle.textContent = responsibleMining
          ? `♻️ Responsible Mining ON  (${extraCost}${extraEffect ? " → " + extraEffect : ""})`
          : `⛏️ Standard Mining`;
        rmToggle.style.background = responsibleMining ? "rgba(46,204,113,0.2)" : "rgba(231,76,60,0.15)";
        rmToggle.style.borderColor = responsibleMining ? "#2ecc71" : "#555";
      };
      updateRmBtn();
      rmToggle.addEventListener("click", (e) => {
        e.stopPropagation();
        responsibleMining = !responsibleMining;
        updateRmBtn();
      });
      rmBar.appendChild(rmToggle);
      el.appendChild(rmBar);
    }

    el.addEventListener("click", () => {
      if (!canAffordCard(card)) {
        showFloatingError("Not enough resources to play this card.");
        return;
      }
      const emitPlay = (payTo) => {
        socket.emit("play_card", {
          card_name: card.name,
          use_optional: {},
          pay_to: payTo || {},
          responsible_mining: responsibleMining,
        });
      };
      if (hasFee) {
        showPaymentPopup(card, {}, emitPlay);
      } else {
        emitPlay({});
      }
    });
    // Show fee status hint on the card itself
    if (hasFee) {
      const owns = iOwnFeeCosts(costs);
      const payees = findPayeesForFee(costs);
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

    // Tier indicator (star summary only — upgrade happens in "Show All Cards")
    const cardTiers = c.tiers || [];
    if (cardTiers.length > 0 && c.current_tier > 0) {
      const tierRow = document.createElement("div");
      tierRow.className = "played-mini-tier-row";
      const maxTier = cardTiers.length;
      let tierStr = "";
      for (let t = 1; t <= maxTier; t++) {
        tierStr += t <= c.current_tier ? "★" : "☆";
      }
      const tierSpan = document.createElement("span");
      tierSpan.className = "played-tier-stars";
      tierSpan.textContent = tierStr;
      tierRow.appendChild(tierSpan);
      div.appendChild(tierRow);
    }

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
function renderHandModal() {
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
}

showHandBtn.addEventListener("click", () => {
  renderHandModal();
  handModal.classList.remove("hidden");
});

closeHandModal.addEventListener("click", () => handModal.classList.add("hidden"));
handModal.addEventListener("click", (e) => {
  if (e.target === handModal) handModal.classList.add("hidden");
});

// ── Sidebar renders ─────────────────────────────────────────
const RESOURCE_ORDER = ["money", "data", "engineers", "suits", "servers", "ads"];
const RESOURCE_WIDE = new Set(["money", "data"]);

function renderResources(resources) {
  resourcesDiv.innerHTML = "";
  if (resources.reputation !== undefined) updateReputationBar(resources.reputation);
  RESOURCE_ORDER.forEach(key => {
    const val = resources[key] ?? 0;
    const div = document.createElement("div");
    div.className = "resource-item";
    if (RESOURCE_WIDE.has(key)) div.classList.add("resource-wide");
    const dispVal = key === "money" ? `$${val}B`
                  : key === "data"  ? `${val}PB`
                  : val;
    div.innerHTML = `<span class="label">${prettyRes(key)}</span><span class="value">${dispVal}</span>`;
    resourcesDiv.appendChild(div);
  });
}

// Fallback palette — matches _PLAYER_COLORS on the backend
const PIE_PLAYER_COLORS = ["#f9c912","#00cfff","#4dff91","#ff5ef3","#ff4422","#ff9900","#b966ff","#00e5c3"];

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
  let colorIdx = 0;
  const usedColors = new Set();
  for (const [pid, p] of Object.entries(players)) {
    const u = p.users || 0;
    // Resolve color: use p.color if it's a valid, unique hex; otherwise pick from fallback palette
    let color = p.color && p.color.startsWith("#") ? p.color : null;
    if (!color || usedColors.has(color)) {
      // Find a fallback color not already used
      while (usedColors.has(PIE_PLAYER_COLORS[colorIdx % PIE_PLAYER_COLORS.length])) colorIdx++;
      color = PIE_PLAYER_COLORS[colorIdx % PIE_PLAYER_COLORS.length];
      colorIdx++;
    }
    usedColors.add(color);
    if (u > 0) slices.push({ pid, name: p.name, users: u, color });
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

    ctx.fillStyle = s.color;
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
  const dpu = lastGameState?.params?.data_per_users ?? 200;
  const income = mpu > 0 ? Math.floor(myUsers / mpu) : 0;
  const hint = `100M👥 → $${Math.round(100 / mpu)}B/yr`;
  const dataProd = Math.floor(myUsers / 100) * dpu;
  const dataHint = `100M👥 → ${dpu}PB/yr`;
  info.innerHTML = `<strong>👥 ${myUsers}M</strong> <span class="pie-pct">${myPct}%</span><br><span class="pie-income">💰 $${income}B/yr</span><br><span class="pie-hint">${hint}</span><br><span class="pie-income">📊 ${dataProd}PB/yr</span><br><span class="pie-hint">${dataHint}</span>`;

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
          pieTip.textContent = `${s.name}: ${s.users}M (${pct}%)`;
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
    if (mod > 0) status = `⭐ +${mod}M👥 per gain, +${mod}🔧👔 per hire`;
    else if (mod < 0) status = `⚠️ ${mod}M👥 per gain, ${mod}🔧👔 per hire`;
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

    let displayVal = val;
    let labelHtml = prettyRes(key);

    if (key === "HR") {
      const rep = lastPrivateState?.resources?.reputation || 0;
      const repMod = getRepMod(rep);
      const effective = val >= 0 ? Math.max(0, val + repMod) : val;
      displayVal = effective;
      if (repMod !== 0) {
        const sign = repMod > 0 ? "+" : "";
        labelHtml += ` <span style="font-size:.7em;opacity:.7">(${val}${sign}${repMod} rep)</span>`;
      }
    }

    const prefix = key === "HR" ? "+" : "";
    div.innerHTML = `<span class="label">${labelHtml}</span><span class="value">${prefix}${displayVal}</span>`;
    productionDiv.appendChild(div);
  });

  // Show money production only when non-zero (from factory_refund)
  const moneyProd = production["money"] ?? 0;
  if (moneyProd > 0) {
    const div = document.createElement("div");
    div.className = "resource-item resource-wide";
    div.innerHTML = `<span class="label">💰 Factory income</span><span class="value">$${moneyProd}B/yr</span>`;
    productionDiv.appendChild(div);
  }
}

// ── Helpers ──────────────────────────────────────────────────
const RES_EMOJI = {
  money: "💰", users: "👥", engineers: "🔧", suits: "👔",
  servers: "🖥️", ads: "📢", reputation: "⭐", HR: "🏢",
  data_centers: "🗄️", ad_campaigns: "📣",
  data: "📊",
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

// Format a resource value for display. Users in M, money in B, data in PB.
function fmtCardVal(key, val) {
  if (key === "users") return `${val}M`;
  if (key === "money") return `${val}B`;
  if (key === "data") return `${val}PB`;
  return val;
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
  "social platform":          "🐦",
  "hardware manufacturer":    "📱",
  "software service":         "📜",
  "software platform":        "🏞️",
  "software engine":          "⚙️",
  "online marketplace":       "🛒",
  "search service":           "🔍",
  "store":                    "🏪",
  "power plant":              "⚡",
  "data center":              "🗄️",
  "office":                   "🏢",
  "ad campaign":              "📢",
  "lobby":                    "🏛️",
  "rare metal mine":          "🔩",
  "hydroelectric power plant":"💧",
  "satellite":                "🛰️",
  "network":                  "🕵️",
  "cyber defense":            "🛡️",
};

const CARD_TYPE_TINTS = {
  "social platform":       "#1a2a3e",  // dark blue
  "hardware manufacturer": "#1a1108",  // dark charcoal-brown (was factory, now hw manufacturer)
  "software service":      "#3a1515",  // dark red
  "software platform":     "#251a3a",  // dark purple
  "software engine":       "#0f2a2a",  // dark aquamarine
  "online marketplace":    "#2e1a0a",  // dark orange
  "search service":        "#0f2a18",  // dark green
  "store":                 "#252525",  // dark neutral
  "power plant":           "#1e1208",  // dark brown
  "data center":           "#1a1e22",  // dark slate
  "office":                "#0f1a3a",  // dark royal blue
  "ad campaign":           "#2e0f1e",  // dark pink
  "lobby":                 "#1a2a1a",  // dark forest green
  "rare metal mine":              "#2a3a42",  // dark steel blue-grey
  "hydroelectric power plant":   "#0d3a50",
  "satellite":                   "#0a0a1a",
  "network":                     "#1a1a2e",  // dark indigo
  "cyber defense":               "#0a2a1a",  // dark teal-green
};

const CARD_DECK_EMOJIS = {
  "cyber_attack":  "🕵️",
  "fuck_up":       "💀",
  "innovation":    "💡",
  "leverage":      "📈",
  "company":       "🏦",
  "regulation":    "⚖️",
  "world_event":   "🌍",
};

function createCardElement(card, options = {}) {
  const el = document.createElement("div");
  el.className = "game-card";

  const colorType = (card.card_color_type || card.type || "").toString().toLowerCase();
  const deckType = card.card_type || options.deckType || "";
  const typeEmoji = CARD_SUBTYPE_EMOJIS[colorType]
    || CARD_DECK_EMOJIS[deckType]
    || "";

  if (deckType === "fuck_up") el.classList.add("fuckup-card");
  const tintColor = CARD_TYPE_TINTS[colorType];
  if (tintColor) el.style.background = tintColor;

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
      effectsHtml += effectEntries.map(([k, v]) => `<span class="card-effect-item">${v > 0 ? "+" : ""}${fmtCardVal(k, v)} ${emojiRes(k)}</span>`).join("");
      effectsHtml += `</span></div>`;
    }
  } else {
    const prodText = Object.entries(card.production || {})
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `+${fmtCardVal(k, v)} ${emojiRes(k)}/yr`).join(", ");
    const immText = Object.entries(card.immediate || {})
      .filter(([, v]) => v !== 0)
      .map(([k, v]) => `${v > 0 ? "+" : ""}${fmtCardVal(k, v)} ${emojiRes(k)}`).join(", ");
    if (prodText) effectsHtml += `<div class="card-production">${prodText}</div>`;
    if (immText) effectsHtml += `<div class="card-immediate">${immText}</div>`;
  }

  // Boosts
  let boostsHtml = "";
  if (card.boosts && card.boosts.length) {
    boostsHtml = `<div class="card-boosts"><span class="card-section-label">Boosts</span><span class="card-effects-row">`;
    card.boosts.forEach((b, i) => {
      const bonusEntries = Object.entries(b.bonus || {}).filter(([, v]) => v);
      if (!bonusEntries.length) return;
      const bonusStr = bonusEntries.map(([k, v]) => `${v > 0 ? "+" : ""}${fmtCardVal(k, v)}${emojiRes(k)}`).join(" ");
      let targetStr = "";
      if (b.target_id) {
        const ids = Array.isArray(b.target_id) ? b.target_id : [b.target_id];
        targetStr = ids.map(id => cardNameById(id)).join(", ");
        // target_id: no cap — fires every time; no counter shown
      }
      if (b.target_type) {
        const types = Array.isArray(b.target_type) ? b.target_type : [b.target_type];
        const typeDisplay = types.map(t => CARD_SUBTYPE_EMOJIS[t] || t).join("/");
        const maxCount = b.target_count || 0;
        const fires = (card.boost_fires || [])[i] || 0;
        // Show thumbs: used ones grayed, remaining ones lit
        let thumbStr = "";
        if (maxCount > 0) {
          for (let j = 0; j < maxCount; j++) {
            thumbStr += j < fires
              ? `<span style="opacity:.3;font-size:.8em">👍</span>`
              : `<span style="font-size:.8em">👍</span>`;
          }
        }
        targetStr += (targetStr ? " / " : "") + typeDisplay + (thumbStr ? ` ${thumbStr}` : "");
      }
      if (targetStr) {
        boostsHtml += `<span class="card-boost-item">${targetStr}: ${bonusStr}</span>`;
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
    startHtml += startEntries.map(([k, v]) => `<span class="card-effect-item">${fmtCardVal(k, v)} ${emojiRes(k)}</span>`).join("");
    startHtml += startProdEntries.map(([k, v]) => `<span class="card-effect-item">${v > 0 ? "+" : ""}${fmtCardVal(k, v)} ${emojiRes(k)}/yr</span>`).join("");
    startHtml += `</span></div>`;
  }

  // Build badge
  let buildHtml = "";
  if (card.build) {
    const label = card.build.replace(/_/g, " ");
    buildHtml = `<div class="card-build-badge">🏗️ ${label}</div>`;
  }

  // Enhancement tiers — rendered as interactive buttons in createCardElement post-process
  let tiersHtml = "";
  const cardTiers = card.tiers || [];
  if (cardTiers.length > 0) {
    tiersHtml = `<div class="card-tiers" data-instance-id="${card.instance_id || ""}"><span class="card-section-label">Tiers</span></div>`;
  }

  // Requirements
  let reqHtml = "";
  const reqs = card.requirements || [];
  if (reqs.length) {
    const reqStr = reqs.map(r => CARD_SUBTYPE_EMOJIS[r] ? `${CARD_SUBTYPE_EMOJIS[r]} ${r}` : r).join(", ");
    reqHtml = `<div class="card-requirements"><span class="card-section-label">Requires</span><span class="card-req-list">${reqStr}</span></div>`;
  }

  // Costs section (new format)
  let costsHtml = "";
  const costs = card.costs || {};
  const COST_SKIP = new Set(["fee", "fee_card_id", "fee_card_type", "fee_company_type", "payee_card_id"]);
  const hasCosts = Object.entries(costs).some(([k, v]) => v && !COST_SKIP.has(k));
  const myRes = lastPrivateState?.resources;
  const canAffordRes = (res, amt) => {
    if (!myRes || !amt) return null;
    if (res === "money") {
      const feeAmt = (!iOwnFeeCosts(costs)) ? (costs.fee || 0) : 0;
      return (myRes.money ?? 0) >= (costs.money || 0) + feeAmt;
    }
    const have = res === "users" ? (lastGameState?.players?.[myPlayerId]?.users ?? 0)
                                 : (myRes[res] ?? 0);
    return have >= amt;
  };
  if (hasCosts) {
    costsHtml = `<div class="card-costs"><span class="card-section-label">Cost</span>`;
    for (const [res, amt] of Object.entries(costs)) {
      if (!amt || COST_SKIP.has(res)) continue;
      const ok = canAffordRes(res, amt);
      const cls = ok === null ? "" : ok ? " cost-ok" : " cost-nok";
      costsHtml += `<span class="card-cost-item${cls}">${fmtCardVal(res, amt)} ${emojiRes(res)}</span>`;
    }
    const feeAmt = costs.fee || 0;
    if (feeAmt) {
      let feeLabel;
      if (costs.fee_card_id)      feeLabel = `${cardNameById(costs.fee_card_id)} owner`;
      else if (costs.fee_card_type)   feeLabel = `"${costs.fee_card_type}" card owner`;
      else if (costs.fee_company_type) feeLabel = `"${costs.fee_company_type}" company`;
      if (feeLabel) {
        const feeOk = myRes ? (myRes.money ?? 0) >= feeAmt : null;
        const feeCls = feeOk === null ? "" : feeOk ? " cost-ok" : " cost-nok";
        costsHtml += `<span class="card-cost-item card-cost-fee${feeCls}">💸 $${feeAmt}M → <em>${feeLabel}</em></span>`;
      }
    }
    costsHtml += `</div>`;
  } else if (card.cost) {
    const ok = myRes ? (myRes.money ?? 0) >= card.cost : null;
    const cls = ok === null ? "" : ok ? " cost-ok" : " cost-nok";
    costsHtml = `<div class="card-costs"><span class="card-section-label">Cost</span><span class="card-cost-item${cls}">💰${card.cost}</span></div>`;
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
    ${tiersHtml}
    ${startHtml}
    ${reqHtml}
    ${costsHtml}
  `;

  // Attach hover logic for cost choices
  if (options.interactive !== false) {
    el.querySelectorAll(".cost-option").forEach(opt => {
      opt.addEventListener("mouseenter", () => opt.classList.add("cost-hover"));
      opt.addEventListener("mouseleave", () => opt.classList.remove("cost-hover"));
    });
  }

  // Inject tier buttons into .card-tiers container
  const tiersContainer = el.querySelector(".card-tiers");
  if (tiersContainer && cardTiers.length > 0) {
    // current_tier semantics:
    //   0 = card not yet played  → all grayed
    //   1 = card played, no tier bought yet → T1 green/red, rest locked
    //   2 = T1 bought → T1 blue, T2 green/red, rest locked
    //   3 = T2 bought → T1/T2 blue, T3 green/red
    const curTier = card.current_tier || 0;
    const notPlayed = curTier === 0;
    const myData = lastPrivateState?.resources?.data ?? 0;
    const myTurn = lastGameState?.current_player_id === myPlayerId;
    const phase = lastGameState?.phase;
    const isMyCard = (lastGameState?.players?.[myPlayerId]?.played_cards || [])
      .some(c => c.instance_id === card.instance_id);
    const canInteract = isMyCard && myTurn && phase === "player_turns";

    cardTiers.forEach((t, i) => {
      const tierNum = i + 1;
      // T1 purchased when curTier >= 2 (i=0 → purchased = curTier >= 2)
      const purchased = curTier >= tierNum + 1;
      // T1 is next to buy when curTier === 1 (i=0 → isNext = curTier === 1)
      const isNext = curTier === tierNum;
      const locked = notPlayed || curTier < tierNum;

      const cost = t.data_cost ?? 0;
      const usersGain = t.users ?? 0;
      const moneyGain = t.money ?? 0;
      const canAfford = myData >= cost;

      // Build label: T1: 200PB → +150M👥 +5B💰/yr
      let label = `T${tierNum}: ${cost}PB`;
      if (usersGain) label += ` → +${usersGain}M👥`;
      if (moneyGain) label += ` +$${moneyGain}B/yr`;

      // Hover tooltip always shows current data
      const dataHint = `You have ${myData}PB`;

      const btn = document.createElement("button");
      btn.className = "card-tier-btn";
      btn.textContent = label;

      if (locked) {
        btn.classList.add("tier-btn-locked");
        btn.disabled = true;
        btn.title = notPlayed
          ? `Play this card first — ${dataHint}`
          : `Unlock T${tierNum - 1} first — ${dataHint}`;
      } else if (purchased) {
        btn.classList.add("tier-btn-owned");
        btn.disabled = true;
        btn.title = `Tier ${tierNum} purchased ✓`;
      } else if (isNext) {
        btn.classList.add(canAfford ? "tier-btn-available" : "tier-btn-cant");
        btn.title = canAfford
          ? `Purchase T${tierNum} for ${cost}PB — ${dataHint}`
          : `Need ${cost}PB to purchase — ${dataHint}`;
        if (canAfford) {
          // Click always goes to server — it validates turn/phase and returns an error if needed.
          // Immediately disable after click to prevent double-firing while server processes.
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            btn.disabled = true;
            socket.emit("upgrade_card_tier", { instance_id: card.instance_id });
          });
        } else {
          btn.disabled = true;
        }
      } else {
        // Fallback (shouldn't happen)
        btn.classList.add("tier-btn-locked");
        btn.disabled = true;
        btn.title = dataHint;
      }

      tiersContainer.appendChild(btn);
    });
  }

  return el;
}

// ── Parameters editor ────────────────────────────────────────
const paramsModal = document.getElementById("params-modal");
const paramsBody = document.getElementById("params-body");

const PARAM_LABELS = {
  total_users: "Total Users in Pool (×1M)",
  money_per_users: "$B/yr per 100M users",
  data_per_users: "PB/yr per 100M users",
  projects_draw: "Cards from Projects Deck",
  boosters_draw: "Cards from Boosters Deck",
  build_row_size: "Shared Build Row Size (cards below board)",
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

// ── Card-played notification popup ──────────────────────────
const cardPlayedPopup = document.getElementById("card-played-popup");
const cardPlayedMsg   = document.getElementById("card-played-msg");
const cardPlayedBody  = document.getElementById("card-played-body");
document.getElementById("card-played-ok").addEventListener("click", () => cardPlayedPopup.classList.add("hidden"));
cardPlayedPopup.addEventListener("click", (e) => { if (e.target === cardPlayedPopup) cardPlayedPopup.classList.add("hidden"); });

socket.on("card_played_notification", (data) => {
  // Don't show to the player who played the card
  if (data.player_id === myPlayerId) return;
  cardPlayedMsg.textContent = `${data.player_name} played:`;
  cardPlayedBody.innerHTML = "";
  if (data.card) {
    cardPlayedBody.appendChild(createCardElement(data.card, { interactive: false }));
  } else {
    cardPlayedBody.textContent = data.card_name;
  }
  cardPlayedPopup.classList.remove("hidden");
});

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
  "data_centers", "ad_campaigns", "data",
];

const COST_KEY_OPTIONS = [
  "engineers", "suits", "ads", "money",
  "servers", "data_centers", "ad_campaigns",
  "reputation", "HR", "users", "fee", "fee_card_id", "fee_card_type", "fee_company_type",
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
  cyber_attack: "Cyber Warfare",
  fuck_up: "Fuck-ups",
  leverage: "Leverage",
  innovation: "Innovation",
  build: "Build",
  regulation: "Events — Regulation",
  world_event: "Events — World Events 🌍",
};

const editorSearch = document.getElementById("editor-search");
const cardTreesBtn = document.getElementById("card-trees-btn");
const backToGridBtn = document.getElementById("back-to-grid-btn");
backToGridBtn.addEventListener("click", () => {
  // Save current edit form if open, then return to grid
  if (editingKey) {
    const fields = editorBody.querySelector(".editor-fields");
    const [ct, idx] = editingKey.split(":");
    const card = editorCards[ct]?.[parseInt(idx)];
    if (fields && card) {
      const cardData = collectFormData(fields, card);
      socket.emit("save_card", { card_type: ct, index: parseInt(idx), card_data: cardData });
    }
    editingKey = null;
  }
  _editorOpenIntent = true;
  setTimeout(() => socket.emit("get_all_cards"), 300);
});
const treesModal = document.getElementById("trees-modal");
const closeTreesModal = document.getElementById("close-trees-modal");
const treesStats = document.getElementById("trees-stats");
const treesSearch = document.getElementById("trees-search");
const treesBody = document.getElementById("trees-body");

let _editorOpenIntent = false;  // true when user explicitly clicked "Edit Cards"

editCardsBtn.addEventListener("click", () => {
  editorContext = "grid";
  _editorOpenIntent = true;
  socket.emit("get_all_cards");
});

document.getElementById("edit-cards-lobby-btn").addEventListener("click", () => {
  editorContext = "grid";
  _editorOpenIntent = true;
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
  // Open the modal only when the user explicitly requested it;
  // background broadcasts (from other editors saving) must not pop it open.
  if (_editorOpenIntent) {
    _editorOpenIntent = false;
    editorModal.classList.remove("hidden");
    editorTitle.textContent = "Card Editor";
    if (!editingKey) renderEditorGrid();
  } else if (!editorModal.classList.contains("hidden")) {
    // Editor already open — refresh the grid in place
    if (!editingKey) renderEditorGrid();
  }
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

// ── Editor scroll-to-top button ───────────────────────────────
const editorScrollTopBtn = document.getElementById("editor-scroll-top");
editorBody.addEventListener("scroll", () => {
  editorScrollTopBtn.classList.toggle("visible", editorBody.scrollTop > 200);
});
editorScrollTopBtn.addEventListener("click", () => {
  editorBody.scrollTo({ top: 0, behavior: "smooth" });
});

// ── Editor Stats Charts ───────────────────────────────────────
const editorStatsPanel = document.getElementById("editor-stats-panel");

const CHART_PALETTES = {
  overall:  ["#f9c912", "#00cfff"],
  projects: ["#f9c912", "#ff4422", "#ff6b35", "#4dff91"],
  boosters: ["#00cfff", "#b966ff"],
  platform: ["#4488ff", "#111111", "#cc2222", "#7733bb", "#116655", "#994400",
             "#117733", "#222222", "#8833aa", "#2255cc", "#115588", "#cc4488", "#1a4a1a"],
  build:    ["#e67e22", "#3498db", "#1abc9c", "#9b59b6", "#f1c40f", "#e74c3c", "#2ecc71"],
};

function drawPie(canvasId, slices) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const size = 180;
  canvas.width = canvas.height = size * dpr;
  canvas.style.width = canvas.style.height = size + "px";
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, size, size);
  const cx = size / 2, cy = size / 2;
  const outerR = cx - 4, innerR = outerR * 0.48;
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (!total) return;
  let angle = -Math.PI / 2;
  const gap = slices.length > 1 ? 0.025 : 0;
  // Store slice angle ranges for hover detection
  const sliceAngles = slices.map(s => {
    const sweep = (s.value / total) * Math.PI * 2;
    const entry = { ...s, start: angle, end: angle + sweep, total };
    ctx.beginPath();
    ctx.arc(cx, cy, outerR, angle + gap, angle + sweep - gap);
    ctx.arc(cx, cy, innerR, angle + sweep - gap, angle + gap, true);
    ctx.closePath();
    ctx.fillStyle = s.color;
    ctx.fill();
    ctx.strokeStyle = "#0a0a0a";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    angle += sweep;
    return entry;
  });
  ctx.font = `bold ${Math.round(outerR * 0.22)}px 'Share Tech Mono',monospace`;
  ctx.fillStyle = "#7a7260";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(total), cx, cy);

  // Attach hover tooltip
  let tip = canvas._pieTip;
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "pie-tooltip";
    tip.style.position = "fixed";
    tip.style.pointerEvents = "none";
    tip.style.display = "none";
    document.body.appendChild(tip);
    canvas._pieTip = tip;
  }
  canvas.onmousemove = (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const dx = mx - cx, dy = my - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < innerR || dist > outerR) { tip.style.display = "none"; return; }
    let a = Math.atan2(dy, dx);
    if (a < -Math.PI / 2) a += Math.PI * 2;
    const hit = sliceAngles.find(s => a >= s.start && a < s.end);
    if (hit) {
      const pct = Math.round((hit.value / hit.total) * 100);
      tip.textContent = `${hit.label}: ${hit.value} (${pct}%)`;
      tip.style.display = "block";
      tip.style.left = (e.clientX + 12) + "px";
      tip.style.top  = (e.clientY - 10) + "px";
    } else {
      tip.style.display = "none";
    }
  };
  canvas.onmouseleave = () => { tip.style.display = "none"; };
}

function makeLegend(slices, total) {
  const div = document.createElement("div");
  div.className = "editor-chart-legend";
  slices.forEach(s => {
    const item = document.createElement("div");
    item.className = "editor-legend-item";
    const pct = total ? Math.round((s.value / total) * 100) : 0;
    item.innerHTML = `<span class="editor-legend-swatch" style="background:${s.color}"></span>${s.label}: ${s.value} (${pct}%)`;
    div.appendChild(item);
  });
  return div;
}

let editorChartsCollapsed = false;

function renderEditorCharts({ totalCards, typeCounts, deckCounts, extraCounts = {}, DECK_MAP, allCards = {} }) {
  const panel = editorStatsPanel;
  panel.innerHTML = "";

  // Minimize toggle button
  const toggleBtn = document.createElement("button");
  toggleBtn.className = "btn btn-sm editor-charts-toggle";
  toggleBtn.title = editorChartsCollapsed ? "Show charts" : "Hide charts";
  toggleBtn.textContent = editorChartsCollapsed ? "▼ Charts" : "▲ Hide";
  toggleBtn.addEventListener("click", () => {
    editorChartsCollapsed = !editorChartsCollapsed;
    renderEditorCharts({ totalCards, typeCounts, deckCounts, extraCounts, DECK_MAP, allCards });
  });
  panel.appendChild(toggleBtn);

  if (editorChartsCollapsed) return;

  const TYPE_LABELS = {
    platform: "Platform", cyber_attack: "Cyber Warfare", fuck_up: "Fuck-ups", build: "Build",
    leverage: "Leverage", innovation: "Innovation",
    company: "Company", regulation: "Regulation", world_event: "World Events",
  };

  function makeChart(title, slices, container) {
    if (!slices.length) return;
    const total = slices.reduce((s, x) => s + x.value, 0);
    if (!total) return;
    const wrap = document.createElement("div");
    wrap.className = "editor-chart-wrap";
    const lbl = document.createElement("div");
    lbl.className = "editor-chart-title";
    lbl.textContent = title;
    wrap.appendChild(lbl);
    const canvasId = "ec-" + title.replace(/[^a-z0-9]/gi, "-").toLowerCase();
    const canvas = document.createElement("canvas");
    canvas.id = canvasId;
    wrap.appendChild(canvas);
    wrap.appendChild(makeLegend(slices, total));
    (container || panel).appendChild(wrap);
    requestAnimationFrame(() => drawPie(canvasId, slices));
  }

  // ── Row 1: Overall + Projects + Boosters ──────────────────
  const row1 = document.createElement("div");
  row1.className = "editor-charts-row";
  panel.appendChild(row1);

  // Overall: Projects + Boosters + Company + Events
  const OVERALL_COLORS = ["#f9c912", "#00cfff", "#ff9900", "#ff5ef3"];
  const overallSlices = [
    ...Object.entries(deckCounts).map(([deck, n], i) => ({
      label: deck, value: n, color: OVERALL_COLORS[i % OVERALL_COLORS.length],
    })),
    ...(extraCounts.company ? [{ label: "Company", value: extraCounts.company, color: "#ff9900" }] : []),
    ...(extraCounts.events  ? [{ label: "Events",  value: extraCounts.events,  color: "#ff5ef3" }] : []),
  ];
  makeChart("Overall", overallSlices, row1);

  // Per-deck breakdown (Projects, Boosters) — exclude Build from row 1
  const deckTypeMap = {};
  for (const [ct, n] of Object.entries(typeCounts)) {
    const deck = DECK_MAP[ct] || ct;
    if (deck === "Build") continue;  // shown separately in row 2
    if (!deckTypeMap[deck]) deckTypeMap[deck] = [];
    deckTypeMap[deck].push({ ct, n });
  }
  const deckPalettes = { Projects: CHART_PALETTES.projects, Boosters: CHART_PALETTES.boosters };
  for (const [deck, types] of Object.entries(deckTypeMap)) {
    const palette = deckPalettes[deck] || CHART_PALETTES.projects;
    const slices = types.map(({ ct, n }, i) => ({
      label: TYPE_LABELS[ct] || ct, value: n,
      color: palette[i % palette.length],
    }));
    makeChart(deck, slices, row1);
  }

  // ── Row 2: Platform by type, Cyber Warfare breakdown, Events breakdown ─
  const row2 = document.createElement("div");
  row2.className = "editor-charts-row";
  panel.appendChild(row2);

  // Platform breakdown — count by card type field
  const platformTypeCounts = {};
  for (const card of (allCards.platform || [])) {
    const t = card.type || "(none)";
    platformTypeCounts[t] = (platformTypeCounts[t] || 0) + 1;
  }
  const platformSlices = Object.entries(platformTypeCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([t, n], i) => ({
      label: t, value: n,
      color: CHART_PALETTES.platform[i % CHART_PALETTES.platform.length],
    }));
  makeChart("Platform", platformSlices, row2);

  // Cyber Warfare — split by card type (network attack vs cyber defense)
  const cyberTypeCounts = {};
  for (const card of (allCards.cyber_attack || [])) {
    const t = card.type || "network";
    const label = t === "cyber defense" ? "Cyber Defense 🛡️" : "Cyber Attacks 🕵️";
    cyberTypeCounts[label] = (cyberTypeCounts[label] || 0) + 1;
  }
  const cyberSlices = Object.entries(cyberTypeCounts)
    .map(([label, n]) => ({
      label, value: n,
      color: label.includes("Defense") ? "#0a9a5a" : "#4a2a8a",
    }));
  makeChart("Cyber Warfare", cyberSlices, row2);

  // Build — by tile type (build field)
  const buildTypeCounts = {};
  for (const card of (allCards.build || [])) {
    const b = card.build || "(none)";
    buildTypeCounts[b] = (buildTypeCounts[b] || 0) + 1;
  }
  const buildSlices = Object.entries(buildTypeCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([b, n], i) => ({
      label: b.replace(/_/g, " "), value: n,
      color: CHART_PALETTES.build[i % CHART_PALETTES.build.length],
    }));
  makeChart("Build", buildSlices, row2);

  // Events — regulation vs world_event
  const eventsSlices = [
    ...(extraCounts.regulation  ? [{ label: "Regulation ⚖️",   value: extraCounts.regulation,  color: "#ff5ef3" }] : []),
    ...(extraCounts.world_event ? [{ label: "World Events 🌍",  value: extraCounts.world_event, color: "#00d4aa" }] : []),
  ];
  makeChart("Events", eventsSlices, row2);
}

// ── Editor Grid ──────────────────────────────────────────────
function renderEditorGrid() {
  backToGridBtn.classList.add("hidden");
  editorTitle.textContent = "Card Editor";
  editorBody.innerHTML = "";
  editingKey = null;
  requestAnimationFrame(() => { editorBody.scrollTop = editorScrollTop; });
  editorTitle.textContent = "Card Editor";

  const query = (editorSearch.value || "").toLowerCase().trim();

  const DECK_MAP = {
    platform: "Projects", cyber_attack: "Projects", fuck_up: "Projects",
    leverage: "Boosters", innovation: "Boosters",
    build: "Build",
  };
  let totalCards = 0;
  const typeCounts = {};
  const deckCounts = {};
  const extraCounts = {}; // company, events (regulation+world_event) — shown in overall only
  for (const [ct, cards] of Object.entries(editorCards)) {
    const n = (cards || []).length;
    if (ct === "company") {
      extraCounts.company = n;
      continue;
    }
    if (ct === "regulation" || ct === "world_event") {
      extraCounts.events = (extraCounts.events || 0) + n;
      // track sub-counts for breakdown chart
      extraCounts.regulation = (extraCounts.regulation || 0) + (ct === "regulation" ? n : 0);
      extraCounts.world_event = (extraCounts.world_event || 0) + (ct === "world_event" ? n : 0);
      continue;
    }
    totalCards += n;
    typeCounts[ct] = n;
    const deck = DECK_MAP[ct] || ct;
    deckCounts[deck] = (deckCounts[deck] || 0) + n;
  }

  // Expose stats data for the pie chart renderer, passing raw card arrays for breakdown charts
  renderEditorCharts({ totalCards, typeCounts, deckCounts, extraCounts, DECK_MAP,
    allCards: editorCards });

  // Track if we've already emitted the Events group banner
  let eventsGroupRendered = false;

  for (const [cardType, cards] of Object.entries(editorCards)) {
    const filtered = (cards || []).map((card, index) => ({ card, index }));
    const visible = query
      ? filtered.filter(({ card }) =>
          (card.name || "").toLowerCase().includes(query) ||
          String(card.id ?? "").includes(query))
      : filtered;

    if (visible.length === 0 && query) continue;

    // Inject a shared "EVENTS" group banner before the first events section
    if ((cardType === "regulation" || cardType === "world_event") && !eventsGroupRendered) {
      eventsGroupRendered = true;
      const groupBanner = document.createElement("div");
      groupBanner.className = "editor-group-banner";
      groupBanner.textContent = "⚡ EVENTS";
      editorBody.appendChild(groupBanner);
    }

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

    let dragSrcIndex = null;

    visible.forEach(({ card, index }) => {
      const key = `${cardType}:${index}`;
      const lockStatus = editorLocksMap[key];

      const wrapper = document.createElement("div");
      wrapper.className = "editor-card-wrapper";
      wrapper.draggable = true;
      wrapper.dataset.index = index;
      wrapper.dataset.cardType = cardType;
      if (lockStatus === "other") wrapper.classList.add("editor-card-locked");

      wrapper.addEventListener("dragstart", (e) => {
        dragSrcIndex = index;
        wrapper.classList.add("drag-source");
        e.dataTransfer.effectAllowed = "move";
      });
      wrapper.addEventListener("dragend", () => {
        wrapper.classList.remove("drag-source");
        grid.querySelectorAll(".drag-over").forEach(el => el.classList.remove("drag-over"));
      });
      wrapper.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        grid.querySelectorAll(".drag-over").forEach(el => el.classList.remove("drag-over"));
        if (index !== dragSrcIndex) wrapper.classList.add("drag-over");
      });
      wrapper.addEventListener("dragleave", () => wrapper.classList.remove("drag-over"));
      wrapper.addEventListener("drop", (e) => {
        e.preventDefault();
        wrapper.classList.remove("drag-over");
        if (dragSrcIndex === null || dragSrcIndex === index) return;
        editorScrollTop = editorBody.scrollTop;
        socket.emit("reorder_cards", {
          card_type: cardType,
          from_index: dragSrcIndex,
          to_index: index,
        });
        dragSrcIndex = null;
      });

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

      // Dim the card visually when disabled
      if (card.disabled) {
        cardEl.style.opacity = "0.35";
        cardEl.style.filter = "grayscale(80%)";
      }

      // Disable toggle — sits below the card, outside the click-to-edit zone
      const disableToggle = document.createElement("button");
      disableToggle.className = "editor-disable-btn" + (card.disabled ? " editor-disable-btn--off" : "");
      disableToggle.textContent = card.disabled ? "🔴 Disabled" : "🟢 Active";
      disableToggle.title = card.disabled ? "Click to re-activate this card" : "Click to deactivate this card";
      disableToggle.addEventListener("click", (e) => {
        e.stopPropagation();
        editorScrollTop = editorBody.scrollTop;
        socket.emit("set_card_disabled", {
          card_type: cardType,
          index,
          disabled: !card.disabled,
        });
      });
      wrapper.appendChild(disableToggle);

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
  backToGridBtn.classList.remove("hidden");
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
    } else if (key === "requirements") {
      fields.appendChild(buildRequirementsField(value || []));
    } else if (key === "tiers") {
      fields.appendChild(buildTiersField(value || []));
    } else if (key === "current_tier" || key === "instance_id") {
      // skip — managed by backend
    } else if (DICT_FIELDS.has(key)) {
      const dictVal = (value && typeof value === "object" && !Array.isArray(value)) ? value : {};
      fields.appendChild(buildDictField(key, dictVal));
    } else {
      fields.appendChild(buildSimpleField(key, value, cardType));
    }
  }

  // Always show these fields even if absent from the card data
  for (const key of ALWAYS_SHOW_FIELDS) {
    if (!renderedKeys.has(key)) {
      fields.appendChild(buildSimpleField(key, null, cardType));
    }
  }

  if (!("boosts" in card)) {
    fields.appendChild(buildBoostsField([]));
  }
  if (!("requirements" in card)) {
    fields.appendChild(buildRequirementsField([]));
  }
  if (!("tiers" in card)) {
    fields.appendChild(buildTiersField([]));
  }

  function saveAndGoBack() {
    const cardData = collectFormData(fields, card);
    socket.emit("save_card", { card_type: cardType, index, card_data: cardData });
    editingKey = null;
    _editorOpenIntent = true;
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
  build: [null, "ad_campaign", "data_center", "factory", "hydroelectric_power_plant", "lobby_group", "office", "power_plant", "rare_metal_mine", "satellite", "store"],
};

const TYPE_OPTIONS = [
  "social platform", "hardware manufacturer", "software service",
  "software platform", "software engine",
  "online marketplace", "search service", "store", "power plant",
  "data center", "office", "ad campaign", "lobby", "rare metal mine",
  "hydroelectric power plant", "satellite",
  "network", "cyber defense",
];

// Fields that are always numeric (even when their current value is null)
const NUMERIC_FIELDS = new Set(["factory_refund", "dc_production_bonus"]);

// cardType: optional string ("company", "platform", etc.) used for conditional field rendering
function buildSimpleField(key, value, cardType) {
  const row = document.createElement("div");
  row.className = "editor-field";

  const label = document.createElement("label");
  label.textContent = key;
  row.appendChild(label);

  if (key === "type") {
    // Card-type dropdown — shared by platform, build, company, etc.
    const sel = document.createElement("select");
    sel.dataset.fieldKey = key;
    const noneOpt = document.createElement("option");
    noneOpt.value = ""; noneOpt.textContent = "(none)";
    if (!value) noneOpt.selected = true;
    sel.appendChild(noneOpt);
    TYPE_OPTIONS.forEach(opt => {
      const o = document.createElement("option");
      o.value = opt; o.textContent = opt;
      if (value === opt) o.selected = true;
      sel.appendChild(o);
    });
    row.appendChild(sel);
  } else if (FIELD_OPTIONS[key]) {
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

// Keys whose dict values should be a TYPE_OPTIONS dropdown instead of a number input
const STRING_VAL_DICT_KEYS = new Set(["fee_card_type", "fee_company_type"]);

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

  const removeBtn = document.createElement("button");
  removeBtn.className = "btn btn-sm editor-remove-btn";
  removeBtn.textContent = "\u00d7";
  removeBtn.addEventListener("click", () => row.remove());

  // Build the appropriate value element for a given key
  function makeValEl(key, val) {
    if (STRING_VAL_DICT_KEYS.has(key)) {
      const sel = document.createElement("select");
      sel.className = "editor-dict-val";
      const noneOpt = document.createElement("option");
      noneOpt.value = ""; noneOpt.textContent = "(none)";
      if (!val) noneOpt.selected = true;
      sel.appendChild(noneOpt);
      TYPE_OPTIONS.forEach(opt => {
        const o = document.createElement("option");
        o.value = opt; o.textContent = opt;
        if (val === opt) o.selected = true;
        sel.appendChild(o);
      });
      return { el: sel, isSpinner: false };
    }
    const inp = document.createElement("input");
    inp.className = "editor-dict-val";
    inp.type = (val === null || val === undefined) ? "text" : "number";
    inp.value = (val === null || val === undefined) ? "" : val;
    inp.placeholder = "value";
    return { el: inp, isSpinner: inp.type === "number" };
  }

  function attachValEl(key, val) {
    // Remove any existing value element / spinner
    const old = row.querySelector(".editor-dict-val");
    if (old) {
      const spinner = old.closest(".num-spinner");
      (spinner || old).remove();
    }
    const { el, isSpinner } = makeValEl(key, val);
    row.insertBefore(isSpinner ? makeNumSpinner(el) : el, removeBtn);
  }

  row.appendChild(keyEl);
  row.appendChild(removeBtn);
  attachValEl(k, v);

  // When the key changes, swap value element if needed
  keyEl.addEventListener("change", () => {
    const wasString = STRING_VAL_DICT_KEYS.has(k);
    k = keyEl.value;
    const isString = STRING_VAL_DICT_KEYS.has(k);
    if (wasString !== isString) {
      attachValEl(k, isString ? null : 0);
    }
  });

  return row;
}

// ── Requirements field builder ───────────────────────────────
function buildRequirementsField(requirements) {
  const container = document.createElement("div");
  container.className = "editor-boosts-field";
  container.dataset.requirementsKey = "requirements";

  const header = document.createElement("div");
  header.className = "editor-field-header";
  header.textContent = "requirements";
  container.appendChild(header);

  const list = document.createElement("div");
  list.className = "editor-requirements-list";
  container.appendChild(list);

  function addReqRow(val) {
    const row = document.createElement("div");
    row.className = "editor-req-row editor-dict-row";
    const sel = document.createElement("select");
    sel.className = "editor-req-type";
    sel.style.flex = "1";
    const noneOpt = document.createElement("option");
    noneOpt.value = ""; noneOpt.textContent = "(choose type)";
    if (!val) noneOpt.selected = true;
    sel.appendChild(noneOpt);
    TYPE_OPTIONS.forEach(t => {
      const o = document.createElement("option");
      o.value = t; o.textContent = t;
      if (t === val) o.selected = true;
      sel.appendChild(o);
    });
    const rmBtn = document.createElement("button");
    rmBtn.className = "btn btn-sm editor-remove-btn";
    rmBtn.textContent = "×";
    rmBtn.addEventListener("click", () => row.remove());
    row.appendChild(sel);
    row.appendChild(rmBtn);
    list.appendChild(row);
  }

  (requirements || []).forEach(r => addReqRow(r));

  const addBtn = document.createElement("button");
  addBtn.className = "btn btn-sm";
  addBtn.textContent = "+ Add Requirement";
  addBtn.style.marginTop = ".4rem";
  addBtn.addEventListener("click", () => addReqRow(""));
  container.appendChild(addBtn);

  return container;
}

// ── Tiers field builder ───────────────────────────────────────
function buildTiersField(tiers) {
  const container = document.createElement("div");
  container.className = "editor-boosts-field";
  container.dataset.tiersKey = "tiers";

  const header = document.createElement("div");
  header.className = "editor-field-header";
  header.textContent = "tiers (enhancement track)";
  container.appendChild(header);

  const hint = document.createElement("div");
  hint.style.cssText = "font-size:.72rem;color:var(--text-dim);margin-bottom:.4rem";
  hint.textContent = "All tiers are purchasable by spending Data (PB). Values are incremental — what the player gains when buying that tier.";
  container.appendChild(hint);

  const list = document.createElement("div");
  list.className = "editor-tiers-list";
  container.appendChild(list);

  function addTierRow(tierData, idx) {
    const row = document.createElement("div");
    row.className = "editor-tier-row";
    row.style.cssText = "display:flex;align-items:center;gap:.5rem;margin-bottom:.3rem;";

    const lbl = document.createElement("span");
    lbl.style.cssText = "font-size:.75rem;color:var(--text-dim);min-width:3rem;";
    lbl.textContent = `T${idx + 1}:`;
    row.appendChild(lbl);

    const usersLbl = document.createElement("span");
    usersLbl.style.cssText = "font-size:.72rem;color:var(--text-dim);";
    usersLbl.textContent = "+users (M):";
    row.appendChild(usersLbl);

    const usersInput = document.createElement("input");
    usersInput.type = "number";
    usersInput.className = "editor-tier-users";
    usersInput.min = 0;
    usersInput.value = tierData?.users ?? 0;
    usersInput.style.cssText = "width:5rem;";
    row.appendChild(makeNumSpinner(usersInput, { min: 0 }));

    const moneyLbl = document.createElement("span");
    moneyLbl.style.cssText = "font-size:.72rem;color:var(--text-dim);";
    moneyLbl.textContent = "+$B/yr:";
    row.appendChild(moneyLbl);

    const moneyInput = document.createElement("input");
    moneyInput.type = "number";
    moneyInput.className = "editor-tier-money";
    moneyInput.min = 0;
    moneyInput.value = tierData?.money ?? 0;
    moneyInput.style.cssText = "width:5rem;";
    row.appendChild(makeNumSpinner(moneyInput, { min: 0 }));

    const dataLbl = document.createElement("span");
    dataLbl.style.cssText = "font-size:.72rem;color:var(--text-dim);";
    dataLbl.textContent = "cost (PB):";
    row.appendChild(dataLbl);

    const costInput = document.createElement("input");
    costInput.type = "number";
    costInput.className = "editor-tier-cost";
    costInput.min = 0;
    costInput.value = tierData?.data_cost ?? 0;
    costInput.style.cssText = "width:5rem;";
    row.appendChild(makeNumSpinner(costInput, { min: 0 }));

    const rmBtn = document.createElement("button");
    rmBtn.className = "btn btn-sm editor-remove-btn";
    rmBtn.textContent = "×";
    rmBtn.addEventListener("click", () => row.remove());
    row.appendChild(rmBtn);

    list.appendChild(row);
  }

  (tiers || []).forEach((t, i) => addTierRow(t, i));

  const addBtn = document.createElement("button");
  addBtn.className = "btn btn-sm";
  addBtn.textContent = "+ Add Tier";
  addBtn.style.marginTop = ".4rem";
  addBtn.addEventListener("click", () => {
    const rows = list.querySelectorAll(".editor-tier-row");
    addTierRow({ users: 0, money: 0, data_cost: 0 }, rows.length);
  });
  container.appendChild(addBtn);

  return container;
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

const BOOST_TYPE_OPTIONS = [
  null,
  "social platform", "hardware manufacturer", "software service",
  "software platform", "software engine",
  "online marketplace", "search service", "store", "power plant",
  "data center", "office", "ad campaign", "lobby", "rare metal mine",
  "hydroelectric power plant", "satellite",
  "network", "cyber defense",
];

function buildBoostEntry(boost) {
  const entry = document.createElement("div");
  entry.className = "editor-boost-entry";

  // ── target_id ──
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

  // ── target_type (multi-checkbox) ──
  const ttRow = document.createElement("div");
  ttRow.className = "editor-dict-row editor-dict-row-wrap";
  const ttLabel = document.createElement("span");
  ttLabel.className = "editor-boost-label";
  ttLabel.textContent = "target_type:";
  const ttGroup = document.createElement("div");
  ttGroup.className = "type-checkbox-group boost-target-type-group";
  const currentTypes = Array.isArray(boost.target_type)
    ? boost.target_type
    : (boost.target_type ? [boost.target_type] : []);
  BOOST_TYPE_OPTIONS.filter(Boolean).forEach(opt => {
    const lbl = document.createElement("label");
    lbl.className = "type-checkbox-label";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "boost-type-cb";
    cb.value = opt;
    cb.checked = currentTypes.includes(opt);
    lbl.appendChild(cb);
    lbl.appendChild(document.createTextNode(` ${opt}`));
    ttGroup.appendChild(lbl);
  });
  ttRow.appendChild(ttLabel);
  ttRow.appendChild(ttGroup);
  entry.appendChild(ttRow);

  // ── target_count ──
  const tcRow = document.createElement("div");
  tcRow.className = "editor-dict-row";
  const tcLabel = document.createElement("span");
  tcLabel.className = "editor-boost-label";
  tcLabel.textContent = "target_count (max×):";
  const tcInput = document.createElement("input");
  tcInput.type = "number";
  tcInput.className = "boost-target-count";
  tcInput.value = boost.target_count || 0;
  tcInput.placeholder = "0 = unlimited";
  tcRow.appendChild(tcLabel);
  tcRow.appendChild(makeNumSpinner(tcInput, { min: 0 }));
  entry.appendChild(tcRow);

  // ── Mutual exclusivity: target_id disables target_type + target_count ──
  function syncTypeCountState() {
    const usingId = parseInt(tidInput.value) > 0;
    ttGroup.querySelectorAll("input[type=checkbox]").forEach(cb => {
      cb.disabled = usingId;
      if (usingId) cb.checked = false;
    });
    tcInput.disabled = usingId;
    if (usingId) tcInput.value = 0;
    ttRow.style.opacity = usingId ? "0.35" : "1";
    tcRow.style.opacity = usingId ? "0.35" : "1";
  }
  tidInput.addEventListener("input", syncTypeCountState);
  syncTypeCountState(); // apply on initial render

  // ── bonus ──
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
      // String-valued keys (type dropdowns) are stored as strings, not numbers
      const v = STRING_VAL_DICT_KEYS.has(k)
        ? (raw || null)
        : (raw === "" || raw === "null") ? null : Number(raw);
      if (k) dict[k] = v;
    });
    data[dictKey] = Object.keys(dict).length > 0 ? dict : null;
  });

  const reqContainer = fieldsEl.querySelector("[data-requirements-key='requirements']");
  if (reqContainer) {
    const reqs = [...reqContainer.querySelectorAll(".editor-req-type")]
      .map(sel => sel.value)
      .filter(v => v);
    data.requirements = reqs.length > 0 ? reqs : null;
  }

  const tiersContainer = fieldsEl.querySelector("[data-tiers-key='tiers']");
  if (tiersContainer) {
    const tierRows = tiersContainer.querySelectorAll(".editor-tier-row");
    const tiersArr = [];
    tierRows.forEach((row) => {
      const users = Number(row.querySelector(".editor-tier-users")?.value) || 0;
      const money = Number(row.querySelector(".editor-tier-money")?.value) || 0;
      const dataCost = Number(row.querySelector(".editor-tier-cost")?.value) || 0;
      tiersArr.push({ users, money, data_cost: dataCost });
    });
    data.tiers = tiersArr.length > 0 ? tiersArr : null;
  }

  const boostsContainer = fieldsEl.querySelector("[data-boosts-key='boosts']");
  if (boostsContainer) {
    const boosts = [];
    boostsContainer.querySelectorAll(".editor-boost-entry").forEach(entry => {
      const tid = Number(entry.querySelector(".boost-target-id").value) || 0;
      // target_type and target_count only apply when target_id is not set
      const checkedTypes = tid ? [] : [...entry.querySelectorAll(".boost-type-cb:checked")].map(cb => cb.value);
      const targetType = checkedTypes.length === 0 ? null
        : checkedTypes.length === 1 ? checkedTypes[0]
        : checkedTypes;
      const targetCount = (!tid && targetType) ? (Number(entry.querySelector(".boost-target-count")?.value) || 0) : 0;
      const bonus = {};
      entry.querySelectorAll(".boost-bonus-rows .editor-dict-row").forEach(row => {
        const k = row.querySelector(".editor-dict-key").value.trim();
        const v = Number(row.querySelector(".editor-dict-val").value) || 0;
        if (k) bonus[k] = v;
      });
      if (tid || targetType) {
        const b = { target_id: tid || null, target_type: targetType, bonus };
        if (targetType && targetCount) b.target_count = targetCount;
        boosts.push(b);
      }
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
        let targetMatch = false;
        if (tree.is_type_target) {
          const types = Array.isArray(tree.target_types) ? tree.target_types : [tree.target_types];
          targetMatch = types.some(t => (t || "").toLowerCase().includes(query));
        } else {
          targetMatch = (tree.target?.name || "").toLowerCase().includes(query) ||
            String(tree.target?.id ?? "").includes(query);
        }
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
    if (tree.is_type_target) {
      const types = Array.isArray(tree.target_types) ? tree.target_types : [tree.target_types];
      treeTitle.textContent = `Type boost → ${types.join(" / ")}`;
    } else {
      treeTitle.textContent = `Tree: ${tree.target?.name || "?"}`;
    }
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
      const bonusStr = Object.entries(b.bonus).map(([k,v]) => `${v > 0 ? "+" : ""}${fmtCardVal(k, v)} ${emojiRes(k)}`).join(" ") || "none";
      const countStr = b.target_count ? ` (×${b.target_count} max)` : "";
      bonusTag.textContent = `Boost: ${bonusStr}${countStr}`;

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

    if (tree.is_type_target) {
      // Render a label badge for type-based targets
      const types = Array.isArray(tree.target_types) ? tree.target_types : [tree.target_types];
      const badge = document.createElement("div");
      badge.className = "tree-type-target-badge";
      badge.innerHTML = `<div class="tree-type-target-title">Any card of type:</div>` +
        types.map(t => `<div class="tree-type-tag">${CARD_SUBTYPE_EMOJIS[t] || ""} ${t}</div>`).join("");
      targetWrapper.appendChild(badge);
      treeLayout.appendChild(targetWrapper);
    } else {
      const targetLockKey = findEditorKeyForId(tree.target.id, tree.target_card_type);
      const targetLock = targetLockKey ? (treesLocksMap[targetLockKey] || null) : null;
      if (targetLock === "other") targetWrapper.classList.add("editor-card-locked");

      const targetCardEl = createCardElement(tree.target, { interactive: false, deckType: tree.target_card_type });

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
    } // end else (id-target)

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
    } else if (DICT_FIELDS.has(key)) {
      const dictVal = (value && typeof value === "object" && !Array.isArray(value)) ? value : {};
      fields.appendChild(buildDictField(key, dictVal));
    } else {
      fields.appendChild(buildSimpleField(key, value, cardType));
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
const buildRowSection = document.getElementById("build-row-section");
const buildRowCards = document.getElementById("build-row-cards");
const buildRowRemaining = document.getElementById("build-row-remaining");

let boardTiles = [];
const HEX_SIZE = 24;
const SQRT3 = Math.sqrt(3);

const TERRAIN_COLORS = {
  empty:            "#2a2d35",
  city:             "#2a2d35",
  lake:             "#2980b9",
  sea:              "#0a2a6e",
  government:       "#c0392b",
  commercial:       "#1565c0",
  sun:              "#7a5e10",
  wind:             "#1a4a2a",
  gas_reserve:      "#4a3a10",
  coal:             "#1a1a1a",
  wall:             "#3d2b1a",
  rare_metal_mine:  "#3a4a52",
  natural_park:     "#1a3a1a",
  offshore_wind:    "#0a2a6e",
  offshore_solar:   "#0a2a6e",
  space:            "#05050f",
};

const TILE_COLORS = {
  power_plant:               "#f1c40f",
  factory:                   "#8b6914",
  data_center:               "#5dade2",
  store:                     "#27ae60",
  ads:                       "#e056a0",
  rare_metal_mine:           "#7a8a9a",
  hydroelectric_power_plant: "#1a7abf",
  satellite:                 "#8888cc",
};

function hexToRgba(hex, alpha) {
  const h = (hex || "#888888").replace("#", "");
  const full = h.length === 3
    ? h[0]+h[0]+h[1]+h[1]+h[2]+h[2]
    : h;
  const r = parseInt(full.slice(0,2), 16);
  const g = parseInt(full.slice(2,4), 16);
  const b = parseInt(full.slice(4,6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const TILE_LABELS = {
  power_plant:               "⚡",
  factory:                   "🏭",
  data_center:               "🖥️",
  store:                     "🏪",
  ad_campaign:               "📢",
  office:                    "🏢",
  lobby_group:               "💻",
  rare_metal_mine:           "🔩",
  hydroelectric_power_plant: "💧",
  satellite:                 "🛰️",
};

const TILE_FULL_NAMES = {
  power_plant:               "Power Plant",
  factory:                   "Hardware Factory",
  data_center:               "Data Center",
  store:                     "Store",
  ad_campaign:               "Ad Campaign",
  office:                    "Office",
  lobby_group:               "Lobby Group",
  rare_metal_mine:           "Rare Metal Mine",
  hydroelectric_power_plant: "Hydroelectric Power Plant",
  satellite:                 "Satellite",
};

// Placement rules (mirrors board.py can_place logic):
//   rare_metal_mine tile  → only on rare_metal_mine terrain
//   store, lobby_group    → only on commercial terrain
//   everything else       → empty, sun, wind, gas_reserve, coal, natural_park
//   lake/sea/gov/city/wall/rare_metal_mine terrain → blocked for non-mine tiles
const _NO_BUILD = new Set(["government", "city", "wall"]);
const _COMMERCIAL_ONLY = new Set(["store", "lobby_group", "office"]);
const _OPEN_TERRAINS = new Set(["empty", "sun", "wind", "gas_reserve", "coal", "natural_park"]);
const _SPACE_TILES_FE = new Set(["satellite"]);
const _SPACE_TERRAIN_TILES_FE = {
  "space": new Set(["satellite"]),
};
const _SATELLITE_STACKABLE_FE = new Set(["data_center", "power_plant"]);
const _OFFSHORE_TERRAINS_FE = new Set(["offshore_wind", "offshore_solar"]);

// canPlaceOn: checks terrain rules only (no placed_tile info here)
// Pass placedTileType to check stacking on satellites
function canPlaceOn(tileType, terrain, placedTileType) {
  // Stacking on an existing satellite
  if (placedTileType === "satellite") {
    return _SATELLITE_STACKABLE_FE.has(tileType);
  }
  if (_NO_BUILD.has(terrain)) return false;
  // space tiles → space terrains only
  if (_SPACE_TILES_FE.has(tileType)) {
    const allowed = _SPACE_TERRAIN_TILES_FE[terrain];
    return !!(allowed && allowed.has(tileType));
  }
  if (_SPACE_TERRAIN_TILES_FE[terrain]) return _SPACE_TERRAIN_TILES_FE[terrain].has(tileType);
  // hydroelectric → lake only; lake → hydroelectric only
  if (tileType === "hydroelectric_power_plant") return terrain === "lake";
  if (terrain === "lake") return false;
  // rare_metal_mine → its terrain only
  if (tileType === "rare_metal_mine") return terrain === "rare_metal_mine";
  if (terrain === "rare_metal_mine") return false;
  // offshore (wind/solar) → power_plant only
  if (_OFFSHORE_TERRAINS_FE.has(terrain)) return tileType === "power_plant";
  // sea → data_center only
  if (terrain === "sea") return tileType === "data_center";
  // commercial tiles → commercial terrain only
  if (_COMMERCIAL_ONLY.has(tileType)) return terrain === "commercial";
  if (terrain === "commercial") return false;
  return _OPEN_TERRAINS.has(terrain);
}

const CLIENT_TILE_BASE_BONUSES = {
  power_plant:               {},
  factory:                   {},
  data_center:               { production: { data_centers: 1 } },
  store:                     { production: { ad_campaigns: 1 } },
  ad_campaign:               { production: { ad_campaigns: 1 } },
  office:                    { production: { HR: 1 } },
  lobby_group:               {},
  rare_metal_mine:           { production: { money: 10 } },
  hydroelectric_power_plant: { production: { data_centers: 2 } },
  satellite:                 { production: { data_centers: 2 } },
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
    let tileStroke = "#555";
    let tileStrokeWidth = "1.5";
    if (tile.placed_tile) {
      const owner = lastGameState?.players?.[tile.placed_tile.owner_id];
      if (owner?.color) {
        fill = owner.color;
        tileStroke = "#fff";
        tileStrokeWidth = "2";
      } else {
        fill = hexToRgba(TILE_COLORS[tile.placed_tile.type] || "#888888", 0.5);
      }
    } else {
      fill = TERRAIN_COLORS[tile.terrain] || TERRAIN_COLORS.empty;
    }
    poly.setAttribute("fill", fill);
    poly.setAttribute("stroke", tileStroke);
    poly.setAttribute("stroke-width", tileStrokeWidth);
    g.appendChild(poly);

    let label = "";
    let labelColor = "#fff";
    let labelSize = "7";
    if (tile.placed_tile) {
      label = TILE_LABELS[tile.placed_tile.type] || "?";
      labelSize = "12";
      // If a secondary tile is stacked on top, show both
      if (tile.secondary_tile) {
        label = `${TILE_LABELS[tile.secondary_tile.type] || "?"}/${label}`;
        labelSize = "8";
      }
    } else if (tile.name) {
      label = tile.name.length > 6 ? tile.name.slice(0, 6) : tile.name;
      labelSize = (tile.terrain === "lake" || tile.terrain === "sea") ? "6" : "7";
    } else if (tile.terrain === "city") {
      label = "🏙️";
      labelSize = "10";
    } else if (tile.terrain === "commercial") {
      label = "💼";
      labelSize = "10";
    } else if (tile.terrain === "sun") {
      label = "☀️";
      labelSize = "10";
    } else if (tile.terrain === "wind") {
      label = "💨";
      labelSize = "10";
    } else if (tile.terrain === "gas_reserve") {
      label = "🔥";
      labelSize = "10";
    } else if (tile.terrain === "coal") {
      label = "⛏️";
      labelSize = "10";
    } else if (tile.terrain === "wall") {
      label = "🧱";
      labelSize = "12";
    } else if (tile.terrain === "lake") {
      label = "🌊";
      labelSize = "10";
    } else if (tile.terrain === "offshore_wind") {
      label = "💨";
      labelSize = "10";
    } else if (tile.terrain === "offshore_solar") {
      label = "☀️";
      labelSize = "10";
    } else if (tile.terrain === "rare_metal_mine") {
      label = "🔩";
      labelSize = "10";
    } else if (tile.terrain === "natural_park") {
      label = "🌳";
      labelSize = "10";
    } else if (tile.terrain === "space") {
      label = "✨";
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
    const hasReqs = (tile.requirements || []).length > 0;
    if (hasBuildBonus || hasAdjBonus || hasReqs) {
      const dot = document.createElementNS(ns, "circle");
      dot.setAttribute("cx", cx + HEX_SIZE * 0.55);
      dot.setAttribute("cy", cy - HEX_SIZE * 0.55);
      dot.setAttribute("r", 3);
      dot.setAttribute("fill", hasReqs ? "#e74c3c" : hasBuildBonus ? "var(--accent)" : "#f39c12");
      dot.setAttribute("pointer-events", "none");
      g.appendChild(dot);
    }

    g.addEventListener("mouseenter", (e) => {
      let info = `<strong>(${tile.row},${tile.col})</strong>`;
      if (tile.terrain === "city") info += ` — ${tile.name || "City"} (City)`;
      else if (tile.terrain === "lake") info += ` — 🌊 ${tile.name || "Lake"} (hydroelectric only)`;
      else if (tile.terrain === "sea")           info += ` — ${tile.name || "Sea"} (data center only, −$150B)`;
      else if (tile.terrain === "offshore_wind") info += ` — 💨 ${tile.name || "Offshore Wind"} (power plant, −$100B)`;
      else if (tile.terrain === "offshore_solar") info += ` — ☀️ ${tile.name || "Offshore Solar"} (power plant, −$100B)`;
      else if (tile.terrain === "space") {
        info += ` — ✨ ${tile.name || "Space"} (satellite only, −$200B)`;
        if (tile.placed_tile?.type === "satellite" && !tile.secondary_tile)
          info += `<br><span style="color:#f39c12">▸ Stack data center or power plant here</span>`;
      }
      else if (tile.terrain === "sun")         info += ` — ☀️ ${tile.name || "Sun terrain"}`;
      else if (tile.terrain === "wind")        info += ` — 💨 ${tile.name || "Wind terrain"}`;
      else if (tile.terrain === "gas_reserve") info += ` — 🔥 ${tile.name || "Gas Reserve"}`;
      else if (tile.terrain === "coal")        info += ` — ⛏️ ${tile.name || "Coal terrain"}`;
      else if (tile.terrain === "wall")             info += ` — 🧱 ${tile.name || "Wall"} (cannot build)`;
      else if (tile.terrain === "rare_metal_mine")  info += ` — 🔩 ${tile.name || "Rare Metal Deposit"} (mine only)`;
      else if (tile.terrain === "natural_park")     info += ` — 🌳 ${tile.name || "Natural Park"} (−2 🌟 if built here)`;
      else if (tile.terrain === "government") info += ` — ${tile.name || "Gov"} (cannot build)`;
      else if (tile.terrain === "commercial") info += ` — Commercial zone`;
      else if (tile.placed_tile) {
        const owner = lastGameState?.players?.[tile.placed_tile.owner_id];
        info += ` — ${TILE_FULL_NAMES[tile.placed_tile.type] || tile.placed_tile.type}`;
        if (owner) info += ` (${owner.name})`;
        if (tile.secondary_tile) {
          const owner2 = lastGameState?.players?.[tile.secondary_tile.owner_id];
          info += ` + ${TILE_FULL_NAMES[tile.secondary_tile.type] || tile.secondary_tile.type}`;
          if (owner2) info += ` (${owner2.name})`;
        }
      } else {
        info += " — Empty";
      }

      // Show requirements in tooltip
      const tileReqs = tile.requirements || [];
      if (tileReqs.length) {
        const myTypes = new Set(
          (lastGameState?.players?.[lastGameState?.current_player_id]?.played_cards || [])
            .map(c => c.type).filter(Boolean)
        );
        const missingReqs = tileReqs.filter(r => !myTypes.has(r));
        if (missingReqs.length) {
          info += `<br><span style="color:#e74c3c">🔒 Requires: ${missingReqs.map(r => CARD_SUBTYPE_EMOJIS[r] || r).join(", ")}</span>`;
        } else {
          info += `<br><span style="color:#2ecc71">✅ Requirements met: ${tileReqs.map(r => CARD_SUBTYPE_EMOJIS[r] || r).join(", ")}</span>`;
        }
      }

      const myPlayedTypes = new Set(
        (lastGameState?.players?.[lastGameState?.current_player_id]?.played_cards || [])
          .map(c => c.type).filter(Boolean)
      );
      const reqsMet = tileReqs.every(r => myPlayedTypes.has(r));
      const placedType = tile.placed_tile?.type || null;
      const secondaryFilled = !!tile.secondary_tile;
      const canStack = placedType === "satellite" && !secondaryFilled;
      const isPlaceable = pending && reqsMet && (
        canStack
          ? canPlaceOn(pending, tile.terrain, placedType)
          : (!tile.placed_tile && canPlaceOn(pending, tile.terrain))
      );

      if (isPlaceable) {
        const preview = previewPlacementBonuses(tile, pending);
        const parts = [];
        for (const [res, amt] of Object.entries(preview.immediate))
          if (amt) parts.push(`+${fmtCardVal(res, amt)} ${res}`);
        for (const [res, amt] of Object.entries(preview.production))
          if (amt) parts.push(`+${fmtCardVal(res, amt)} ${res}/yr`);
        info += `<br><strong style="color:#2ecc71">▸ ${TILE_FULL_NAMES[pending]}:</strong> `;
        info += parts.length ? parts.join(", ") : "no bonuses";
      } else {
        const ab = Object.entries(tile.adjacency_bonuses || {});
        if (ab.length) info += `<br>Adj: ${ab.map(([k,v]) => `+${fmtCardVal(k,v)} ${k}`).join(", ")}`;
        const bb = tile.build_bonuses || {};
        const bImm = Object.entries(bb.immediate || {});
        const bProd = Object.entries(bb.production || {});
        if (bImm.length || bProd.length) {
          info += `<br>Build: `;
          info += [...bImm.map(([k,v]) => `+${fmtCardVal(k,v)} ${k}`), ...bProd.map(([k,v]) => `+${fmtCardVal(k,v)} ${k}/yr`)].join(", ");
        }
      }

      tooltip.innerHTML = info;
      tooltip.classList.remove("hidden");
      const ttW = tooltip.offsetWidth || 200;
      const ttH = tooltip.offsetHeight || 40;
      const margin = 10;
      let left = e.clientX + 14;
      let top  = e.clientY - 10;
      if (left + ttW + margin > window.innerWidth)  left = e.clientX - ttW - 14;
      if (top  + ttH + margin > window.innerHeight) top  = e.clientY - ttH - 10;
      if (left < margin) left = margin;
      if (top  < margin) top  = margin;
      tooltip.style.left = left + "px";
      tooltip.style.top  = top  + "px";
    });

    g.addEventListener("mouseleave", () => {
      tooltip.classList.add("hidden");
    });

    const _ptType = tile.placed_tile?.type || null;
    const _canStack = _ptType === "satellite" && !tile.secondary_tile;
    const _placeable = pending && (
      _canStack
        ? canPlaceOn(pending, tile.terrain, _ptType)
        : (!tile.placed_tile && canPlaceOn(pending, tile.terrain))
    );
    if (_placeable) {
      poly.classList.add("board-hex-placeable");
      g.style.cursor = "pointer";
      g.addEventListener("click", () => {
        document.querySelectorAll(".board-hex-selected").forEach(el => el.classList.remove("board-hex-selected"));
        poly.classList.add("board-hex-selected");

        const preview = previewPlacementBonuses(tile, pending);
        const parts = [];
        for (const [res, amt] of Object.entries(preview.immediate))
          if (amt) parts.push(`+${fmtCardVal(res, amt)} ${res}`);
        for (const [res, amt] of Object.entries(preview.production))
          if (amt) parts.push(`+${fmtCardVal(res, amt)} ${res}/yr`);
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

  renderBuildRow();
}

function renderBuildRow() {
  if (!buildRowSection || !buildRowCards) return;

  const gs = lastGameState;
  const row = gs?.shared_build_row;

  if (!row || gs?.phase === "company_pick" || gs?.phase === "year_start_draft") {
    buildRowSection.classList.add("hidden");
    return;
  }

  buildRowSection.classList.remove("hidden");

  const remaining = gs.build_remaining ?? 0;
  if (buildRowRemaining) {
    buildRowRemaining.textContent = `(${remaining} left in deck)`;
  }

  const isMyTurn = gs?.current_player_id === myPlayerId;
  const isPlayerTurns = gs?.phase === "player_turns";
  const me = lastPrivateState;
  const cpt = gs?.params?.cards_per_turn ?? 2;
  const playedThisTurn = me?.cards_played_this_turn ?? 0;
  const canPlay = isMyTurn && isPlayerTurns && playedThisTurn < cpt && !me?.pending_tile;

  buildRowCards.innerHTML = "";
  row.forEach((card, rowIdx) => {
    if (!card) {
      const empty = document.createElement("div");
      empty.className = "build-row-slot-empty";
      empty.textContent = "Empty";
      buildRowCards.appendChild(empty);
      return;
    }

    const cardEl = createCardElement(card, { showId: false });
    if (canPlay) {
      cardEl.classList.add("build-playable");
      cardEl.title = "Click to play this card";
      cardEl.addEventListener("click", () => {
        const costs = card.costs || {};
        const parts = [];
        if (costs.money) parts.push(`💰 $${costs.money}B`);
        if (costs.engineers) parts.push(`🔧 ${costs.engineers} Eng`);
        if (costs.suits) parts.push(`👔 ${costs.suits} Suits`);
        const costStr = parts.length ? parts.join(", ") : "free";
        showConfirmDialog(
          `Play "${card.name}" from the Build Market?`,
          () => socket.emit("play_build_card", { row_index: rowIdx }),
          { detail: `Cost: ${costStr}`, confirmText: "Build", cancelText: "Cancel" }
        );
      });
    }
    buildRowCards.appendChild(cardEl);
  });
}

// ══════════════════════════════════════════════════════════════
// ── Board Editor (master / editors only) ─────────────────────
// ══════════════════════════════════════════════════════════════

const boardEditorModal = document.getElementById("board-editor-modal");
const closeBoardEditor = document.getElementById("close-board-editor");
const boardEditorContainer = document.getElementById("board-editor-container");
const boardTileForm = document.getElementById("board-tile-form");
const terrainTypeForm = document.getElementById("terrain-type-form");
const boardEditorTitle = document.getElementById("board-editor-title");
const editBoardBtn = document.getElementById("edit-board-btn");
const editBoardLobbyBtn = document.getElementById("edit-board-lobby-btn");
const editTerrainTypeBtn = document.getElementById("edit-terrain-type-btn");

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
      // In editor there are no live player sessions — always 50% opacity
      fill = hexToRgba(TILE_COLORS[tile.placed_tile.type] || "#888888", 0.5);
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
    } else if (tile.terrain === "commercial") {
      label = "💼"; edLabelSize = "10";
    } else if (tile.terrain === "sun") {
      label = "☀️"; edLabelSize = "10";
    } else if (tile.terrain === "wind") {
      label = "💨"; edLabelSize = "10";
    } else if (tile.terrain === "gas_reserve") {
      label = "🔥"; edLabelSize = "10";
    } else if (tile.terrain === "coal") {
      label = "⛏️"; edLabelSize = "10";
    } else if (tile.terrain === "wall") {
      label = "🧱"; edLabelSize = "12";
    } else if (tile.terrain === "lake") {
      label = "🌊"; edLabelSize = "10";
    } else if (tile.terrain === "offshore_wind") {
      label = "💨"; edLabelSize = "10";
    } else if (tile.terrain === "offshore_solar") {
      label = "☀️"; edLabelSize = "10";
    } else if (tile.terrain === "rare_metal_mine") {
      label = "🔩"; edLabelSize = "10";
    } else if (tile.terrain === "natural_park") {
      label = "🌳"; edLabelSize = "10";
    } else if (tile.terrain === "space") {
      label = "✨"; edLabelSize = "10";
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
        info += [...bImm.map(([k,v]) => `+${fmtCardVal(k,v)} ${k}`), ...bProd.map(([k,v]) => `+${fmtCardVal(k,v)} ${k}/yr`)].join(", ");
      }
      const ab = Object.entries(tile.adjacency_bonuses || {});
      if (ab.length) {
        info += `<br>Adj: ${ab.map(([k,v]) => `+${fmtCardVal(k,v)} ${k}`).join(", ")}`;
      }
      const reqs = tile.requirements || [];
      if (reqs.length) {
        info += `<br>🔒 Requires: ${reqs.map(r => `${CARD_SUBTYPE_EMOJIS[r] || ""} ${r}`).join(", ")}`;
      }
      tooltip.innerHTML = info;
      tooltip.classList.remove("hidden");
      const ttW = tooltip.offsetWidth || 200;
      const ttH = tooltip.offsetHeight || 40;
      const margin = 10;
      let left = e.clientX + 14;
      let top  = e.clientY - 10;
      if (left + ttW + margin > window.innerWidth)  left = e.clientX - ttW - 14;
      if (top  + ttH + margin > window.innerHeight) top  = e.clientY - ttH - 10;
      if (left < margin) left = margin;
      if (top  < margin) top  = margin;
      tooltip.style.left = left + "px";
      tooltip.style.top  = top  + "px";
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

function _boardReqRow(cardType) {
  const row = document.createElement("div");
  row.className = "board-res-row board-req-row";

  const sel = document.createElement("select");
  sel.className = "editor-dict-key";
  sel.style.flex = "1";
  ["", ...TYPE_OPTIONS].forEach(t => {
    const o = document.createElement("option");
    o.value = t;
    o.textContent = t || "— select card type —";
    if (t === cardType) o.selected = true;
    sel.appendChild(o);
  });
  row.appendChild(sel);

  const del = document.createElement("button");
  del.className = "btn btn-sm btn-danger-sm";
  del.textContent = "×";
  del.style.padding = "0 .4rem";
  del.addEventListener("click", () => row.remove());
  row.appendChild(del);

  return row;
}

function _collectReqRows(container) {
  const result = [];
  container.querySelectorAll(".board-req-row").forEach(row => {
    const v = row.querySelector("select")?.value;
    if (v) result.push(v);
  });
  return result;
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
  ["empty", "city", "lake", "sea", "offshore_wind", "offshore_solar", "government",
   "commercial", "sun", "wind", "gas_reserve", "coal", "wall",
   "rare_metal_mine", "natural_park", "space"].forEach(t => {
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

  // --- Requirements ---
  const reqSection = document.createElement("div");
  reqSection.className = "editor-field board-bonus-section";
  const reqTitle = document.createElement("label");
  reqTitle.textContent = "Build requirements (card types player must have played)";
  reqSection.appendChild(reqTitle);
  const reqContainer = document.createElement("div");
  reqContainer.className = "board-res-container";
  (tile.requirements || []).forEach(rt => reqContainer.appendChild(_boardReqRow(rt)));
  const addReqBtn = document.createElement("button");
  addReqBtn.className = "btn btn-sm";
  addReqBtn.textContent = "+ Add requirement";
  addReqBtn.addEventListener("click", () => {
    reqContainer.insertBefore(_boardReqRow(""), addReqBtn);
  });
  reqContainer.appendChild(addReqBtn);
  reqSection.appendChild(reqContainer);
  form.appendChild(reqSection);

  // --- Only Build ---
  const onlyBuildSection = document.createElement("div");
  onlyBuildSection.className = "editor-field board-bonus-section";
  const onlyBuildTitle = document.createElement("label");
  onlyBuildTitle.textContent = "Allowed build types (✓ = allowed, uncheck to block)";
  onlyBuildSection.appendChild(onlyBuildTitle);
  const onlyBuildGrid = document.createElement("div");
  onlyBuildGrid.className = "only-build-grid";
  // Empty only_build means ALL are allowed → show all checked
  const savedOnlyBuild = tile.only_build || [];
  const allAllowed = savedOnlyBuild.length === 0;
  const BUILDABLE_TILE_TYPES = [
    ["power_plant", "⚡ Power Plant"],
    ["data_center", "🖥️ Data Center"],
    ["store", "🏪 Store"],
    ["ad_campaign", "📢 Ad Campaign"],
    ["office", "🏢 Office"],
    ["lobby_group", "💻 Lobby Group"],
    ["rare_metal_mine", "🔩 Rare Metal Mine"],
    ["hydroelectric_power_plant", "💧 Hydro Plant"],
    ["satellite", "🛰️ Satellite"],
    ["factory", "🏭 Hardware Factory"],
  ];
  BUILDABLE_TILE_TYPES.forEach(([val, lbl]) => {
    const cbLabel = document.createElement("label");
    cbLabel.className = "only-build-cb-label";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = val;
    // If nothing was saved (all allowed), check all; otherwise check only saved ones
    cb.checked = allAllowed || savedOnlyBuild.includes(val);
    cbLabel.appendChild(cb);
    cbLabel.appendChild(document.createTextNode(lbl));
    onlyBuildGrid.appendChild(cbLabel);
  });
  onlyBuildSection.appendChild(onlyBuildGrid);
  form.appendChild(onlyBuildSection);

  // --- Hint ---
  const hint = document.createElement("p");
  hint.style.fontSize = ".75rem";
  hint.style.color = "var(--text-dim)";
  hint.style.margin = ".5rem 0";
  hint.innerHTML = "<strong>Store/Lobby/Office</strong> → commercial only | <strong>Power/DC/Factory/etc.</strong> → open terrains | <strong>🔩Mine</strong> → rare_metal_mine | <strong>💧Hydro</strong> → 🌊lake | <strong>Offshore (wind/solar)</strong> → power_plant (−$100B) | <strong>🌊Sea</strong> → data_center (−$150B) | <strong>🌌Space</strong> → satellite (−$200B) | <strong>🌳Park</strong> = −2⭐ | <strong>Gov/City/Wall</strong> → no build";
  form.appendChild(hint);

  boardTileForm.appendChild(form);

  // --- Add tile left/right/top/bottom ---
  const MAX_BOARD_ROWS = 14;
  const MIN_BOARD_ROW = -8;  // must match board.py Board.MIN_ROW
  const existingCoords = new Set(editorBoardTiles.map(t => `${t.row},${t.col}`));
  const has = (r, c) => existingCoords.has(`${r},${c}`);

  const isOdd = tile.row % 2 === 1;
  const topRight = isOdd ? [tile.row - 1, tile.col + 1] : [tile.row - 1, tile.col];
  const topLeft  = isOdd ? [tile.row - 1, tile.col]     : [tile.row - 1, tile.col - 1];
  const botRight = isOdd ? [tile.row + 1, tile.col + 1] : [tile.row + 1, tile.col];
  const botLeft  = isOdd ? [tile.row + 1, tile.col]     : [tile.row + 1, tile.col - 1];

  const addOptions = [];
  // Same row: left / right
  if (!has(tile.row, tile.col - 1))
    addOptions.push({ label: "← Left",        row: tile.row,     col: tile.col - 1 });
  if (!has(tile.row, tile.col + 1))
    addOptions.push({ label: "→ Right",        row: tile.row,     col: tile.col + 1 });
  // Top diagonal neighbours — allowed down to MIN_BOARD_ROW
  if (tile.row - 1 >= MIN_BOARD_ROW) {
    if (!has(...topLeft))
      addOptions.push({ label: "↖ Top-Left",  row: topLeft[0],  col: topLeft[1] });
    if (!has(...topRight))
      addOptions.push({ label: "↗ Top-Right", row: topRight[0], col: topRight[1] });
  }
  // Bottom diagonal neighbours — allowed up to MAX_BOARD_ROWS
  if (tile.row + 1 < MAX_BOARD_ROWS) {
    if (!has(...botLeft))
      addOptions.push({ label: "↙ Bot-Left",  row: botLeft[0],  col: botLeft[1] });
    if (!has(...botRight))
      addOptions.push({ label: "↘ Bot-Right", row: botRight[0], col: botRight[1] });
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
    const requirements = _collectReqRows(reqContainer);
    const checkedTypes = Array.from(onlyBuildGrid.querySelectorAll("input[type=checkbox]:checked"))
      .map(cb => cb.value);
    // All checked = all allowed → save [] (no restriction); partial = explicit whitelist
    const only_build = checkedTypes.length === BUILDABLE_TILE_TYPES.length ? [] : checkedTypes;
    socket.emit("edit_board_tile", {
      row: tile.row,
      col: tile.col,
      terrain: terrainSelect.value,
      name: nameInput.value.trim(),
      build_bonuses: buildBonuses,
      adjacency_bonuses: adjacencyBonuses,
      requirements,
      only_build,
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

// ── Edit by Terrain Type panel ────────────────────────────────
const TERRAIN_OPTIONS = [
  "empty", "city", "lake", "sea", "offshore_wind", "offshore_solar",
  "government", "commercial", "sun", "wind", "gas_reserve", "coal",
  "wall", "rare_metal_mine", "natural_park", "space",
];

const BUILDABLE_TILE_TYPE_OPTIONS = [
  ["power_plant", "⚡ Power Plant"],
  ["data_center", "🖥️ Data Center"],
  ["store", "🏪 Store"],
  ["ad_campaign", "📢 Ad Campaign"],
  ["office", "🏢 Office"],
  ["lobby_group", "💻 Lobby Group"],
  ["rare_metal_mine", "🔩 Rare Metal Mine"],
  ["hydroelectric_power_plant", "💧 Hydro Plant"],
  ["satellite", "🛰️ Satellite"],
  ["factory", "🏭 Hardware Factory"],
];

function renderTerrainTypeForm() {
  terrainTypeForm.classList.remove("hidden");
  boardTileForm.classList.add("hidden");
  terrainTypeForm.innerHTML = "";

  const title = document.createElement("h3");
  title.textContent = "Edit all tiles of a terrain type";
  title.style.marginBottom = ".8rem";
  terrainTypeForm.appendChild(title);

  const hint = document.createElement("p");
  hint.style.cssText = "font-size:.75rem;color:var(--text-dim);margin:.3rem 0 .8rem;";
  hint.textContent = "Changes apply to every tile on the board with the selected terrain. Leave 'Allowed build types' empty to allow all.";
  terrainTypeForm.appendChild(hint);

  // Terrain selector
  const terrainRow = document.createElement("div");
  terrainRow.className = "editor-field";
  const terrainLabel = document.createElement("label");
  terrainLabel.textContent = "Terrain type";
  terrainRow.appendChild(terrainLabel);
  const terrainSel = document.createElement("select");
  terrainSel.className = "editor-dict-key";
  terrainSel.style.width = "100%";
  TERRAIN_OPTIONS.forEach(t => {
    const o = document.createElement("option");
    o.value = t;
    o.textContent = t.charAt(0).toUpperCase() + t.slice(1).replace(/_/g, " ");
    terrainSel.appendChild(o);
  });
  terrainRow.appendChild(terrainSel);
  terrainTypeForm.appendChild(terrainRow);

  // Only build checkboxes — pre-filled from first matching tile
  const onlyBuildSection = document.createElement("div");
  onlyBuildSection.className = "editor-field board-bonus-section";
  const obLabel = document.createElement("label");
  obLabel.textContent = "Allowed build types (✓ = allowed, uncheck to block)";
  onlyBuildSection.appendChild(obLabel);
  const obGrid = document.createElement("div");
  obGrid.className = "only-build-grid";

  function refreshOnlyBuildCheckboxes() {
    const terrain = terrainSel.value;
    const matchingTile = editorBoardTiles.find(t => t.terrain === terrain);
    const savedOb = (matchingTile?.only_build) || [];
    const allAllowedOb = savedOb.length === 0;
    obGrid.innerHTML = "";
    BUILDABLE_TILE_TYPE_OPTIONS.forEach(([val, lbl]) => {
      const cbLabel = document.createElement("label");
      cbLabel.className = "only-build-cb-label";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = val;
      cb.checked = allAllowedOb || savedOb.includes(val);
      cbLabel.appendChild(cb);
      cbLabel.appendChild(document.createTextNode(lbl));
      obGrid.appendChild(cbLabel);
    });
  }
  refreshOnlyBuildCheckboxes();
  terrainSel.addEventListener("change", refreshOnlyBuildCheckboxes);
  onlyBuildSection.appendChild(obGrid);
  terrainTypeForm.appendChild(onlyBuildSection);

  // Actions
  const actions = document.createElement("div");
  actions.className = "editor-form-actions";

  const saveBtn = document.createElement("button");
  saveBtn.className = "btn btn-sm btn-accent";
  saveBtn.textContent = "Apply to all tiles of this terrain";
  saveBtn.addEventListener("click", () => {
    const checkedOb = Array.from(obGrid.querySelectorAll("input[type=checkbox]:checked"))
      .map(cb => cb.value);
    const only_build = checkedOb.length === BUILDABLE_TILE_TYPE_OPTIONS.length ? [] : checkedOb;
    socket.emit("edit_board_terrain_type", {
      terrain: terrainSel.value,
      only_build,
    });
    terrainTypeForm.classList.add("hidden");
  });

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn btn-sm";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => terrainTypeForm.classList.add("hidden"));

  actions.appendChild(saveBtn);
  actions.appendChild(cancelBtn);
  terrainTypeForm.appendChild(actions);

  requestAnimationFrame(() => {
    terrainTypeForm.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
}

editTerrainTypeBtn.addEventListener("click", renderTerrainTypeForm);
