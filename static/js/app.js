const socket = io();

let myRole = null;
let myPlayerId = null;
let myName = null;
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
const regulationArea    = document.getElementById("regulation-area");
const regulationDisplay = document.getElementById("regulation-card-display");
const regulationAlertBox = document.getElementById("regulation-alert-box");
const regulationActions = document.getElementById("regulation-actions");
const regAcceptBtn      = document.getElementById("reg-accept-btn");
const regCourtBtn       = document.getElementById("reg-court-btn");
const regulationResultBox = document.getElementById("regulation-result-box");
const regulationWaiting = document.getElementById("regulation-waiting");
const regProceedBtn     = document.getElementById("reg-proceed-btn");
const turnsArea         = document.getElementById("turns-area");
const fuckupAlert       = document.getElementById("fuckup-alert");
const yearDoneWaiting   = document.getElementById("year-done-waiting");
const turnsContent      = document.getElementById("turns-content");
const handDiv           = document.getElementById("hand-container");
const endTurnBtn        = document.getElementById("end-turn-btn");
const endYearBtn        = document.getElementById("end-year-btn");
const cardsPlayedInfo   = document.getElementById("cards-played-info");
const endGameBar        = document.getElementById("end-game-bar");
const endGameBtn        = document.getElementById("end-game-btn");
const restartGameBtn    = document.getElementById("restart-game-btn");
const showHandBtn       = document.getElementById("show-hand-btn");
const handModal         = document.getElementById("hand-modal");
const closeHandModal    = document.getElementById("close-hand-modal");
const handModalBody     = document.getElementById("hand-modal-body");

const PHASE_LABELS = {
  company_pick: "Company Pick",
  year_start_draft: "Draft",
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
];

const DRAFT_SECTIONS = [
  { deck: "projects", label: "Projects", types: ["platform", "cyber_attack"] },
  { deck: "boosters", label: "Boosters", types: ["leverage", "innovation"] },
];

// ── Screen switching ────────────────────────────────────────
function showScreen(screen) {
  [loginScreen, lobbyScreen, gameScreen].forEach(s => s.classList.remove("active"));
  screen.classList.add("active");
}

function showPhaseArea(phase) {
  [companyPickArea, draftArea, regulationArea, turnsArea].forEach(a => a.classList.add("hidden"));
  const map = {
    company_pick: companyPickArea,
    year_start_draft: draftArea,
    regulation: regulationArea,
    player_turns: turnsArea,
  };
  if (map[phase]) map[phase].classList.remove("hidden");
}

// ── Login ───────────────────────────────────────────────────
loginBtn.addEventListener("click", () => {
  const name = playerNameIn.value.trim();
  const password = passwordIn.value;
  if (!name) { loginError.textContent = "Enter your name."; return; }
  socket.emit("login", { name, password });
});

passwordIn.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loginBtn.click();
});

socket.on("login_success", (data) => {
  myRole = data.role;
  myPlayerId = data.player_id;
  myName = data.name;
  loginError.textContent = "";
  showScreen(lobbyScreen);
  if (myRole === "master") {
    startGameBtn.classList.remove("hidden");
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
socket.on("game_started", (state) => {
  showScreen(gameScreen);
  if (myRole === "master") {
    endGameBar.classList.remove("hidden");
  }
  renderGameState(state);
});

socket.on("game_state", (state) => {
  renderGameState(state);
});

socket.on("your_state", (data) => {
  lastPrivateState = data;
  renderResources(data.resources);
  renderProduction(data.production);
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
    regulationWaiting.textContent = "Waiting for others to resolve their compliance...";
    regulationWaiting.classList.remove("hidden");
  } else {
    regulationWaiting.classList.add("hidden");
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

// ── Render game state ───────────────────────────────────────
function renderGameState(state) {
  lastGameState = state;
  yearBadge.textContent = `Year ${state.year}`;
  phaseBadge.textContent = PHASE_LABELS[state.phase] || state.phase;
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

  if (state.phase === "regulation") {
    renderRegulation(state.current_regulation);
  }

  updateTurnsUI();
  updateRegulationUI();

  draftYear.textContent = state.year;

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
      keepBtn.textContent = "Keep (3 money)";
      keepBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        socket.emit("keep_card", { card_name: card.name });
      });
      el.appendChild(keepBtn);
      grid.appendChild(el);
    });
    sectionDiv.appendChild(grid);
    draftContainer.appendChild(sectionDiv);
  });

  if (draftedFuckups && draftedFuckups.length > 0) {
    const sectionDiv = document.createElement("div");
    sectionDiv.className = "draft-section";
    const h3 = document.createElement("h3");
    h3.className = "draft-section-title";
    h3.textContent = "Fuck-ups";
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

// ── Regulation ──────────────────────────────────────────────
function renderRegulation(card) {
  if (!card) {
    regulationDisplay.innerHTML = `<p class="text-dim">No regulation card this year.</p>`;
    return;
  }
  regulationDisplay.innerHTML = "";
  const el = createCardElement(card);
  const penaltyText = Object.entries(card.penalty || {})
    .map(([k, v]) => `${v > 0 ? "+" : ""}${v} ${k}`)
    .join(", ");
  if (penaltyText) {
    const penDiv = document.createElement("div");
    penDiv.className = "regulation-penalty-info";
    penDiv.innerHTML = `<strong>Penalty if accept:</strong> ${penaltyText}`;
    el.appendChild(penDiv);
  }
  regulationDisplay.appendChild(el);
}

socket.on("regulation_alert", (data) => {
  if (data.affected) {
    const penText = Object.entries(data.penalty)
      .map(([k, v]) => `${v > 0 ? "+" : ""}${v} ${k}`).join(", ");
    const courtText = Object.entries(data.court_penalty)
      .map(([k, v]) => `${v > 0 ? "+" : ""}${v} ${k}`).join(", ");
    regulationAlertBox.innerHTML = `
      <p><strong>This regulation affects you!</strong></p>
      <p>Accept penalty: ${penText}</p>
      <p>Court loss penalty: ${courtText} (need ${data.court_threshold}+ on d6 to win)</p>
    `;
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
  if (data.action === "accept") {
    const penText = Object.entries(data.penalty)
      .map(([k, v]) => `${v > 0 ? "+" : ""}${v} ${k}`).join(", ");
    regulationResultBox.innerHTML = `<p>You accepted the penalty: ${penText}</p>`;
  } else {
    const result = data.won ? "Won" : "Lost";
    let msg = `<p>Court roll: <strong>${data.roll}</strong> (needed ${data.threshold}+) — <strong>${result}!</strong></p>`;
    if (!data.won) {
      const penText = Object.entries(data.penalty)
        .map(([k, v]) => `${v > 0 ? "+" : ""}${v} ${k}`).join(", ");
      msg += `<p>Court penalty applied: ${penText}</p>`;
    } else {
      msg += `<p>No penalty — you beat the case!</p>`;
    }
    regulationResultBox.innerHTML = msg;
  }
  regProceedBtn.classList.add("hidden");
  regulationWaiting.textContent = "Waiting for others to resolve their compliance...";
  regulationWaiting.classList.remove("hidden");
});

// ── Hand (player turns) ────────────────────────────────────
function renderHand(hand) {
  handDiv.innerHTML = "";
  hand.forEach(card => {
    const el = createCardElement(card);
    if (card.card_type === "fuck_up") {
      el.classList.add("fuckup-card");
    }
    el.addEventListener("click", () => {
      socket.emit("play_card", { card_name: card.name });
    });
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
      floatingTooltip.style.top = rect.top + "px";
      floatingTooltip.style.left = (rect.right + 8) + "px";
    });

    div.addEventListener("mouseleave", () => {
      floatingTooltip.classList.add("hidden");
    });

    playedDiv.appendChild(div);
  });
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
function renderResources(resources) {
  resourcesDiv.innerHTML = "";
  Object.entries(resources).forEach(([key, val]) => {
    const div = document.createElement("div");
    div.className = "resource-item";
    div.innerHTML = `<span class="label">${key}</span><span class="value">${val}</span>`;
    resourcesDiv.appendChild(div);
  });
}

function renderProduction(production) {
  productionDiv.innerHTML = "";
  Object.entries(production).forEach(([key, val]) => {
    const div = document.createElement("div");
    div.className = "resource-item";
    div.innerHTML = `<span class="label">${key}</span><span class="value">+${val}</span>`;
    productionDiv.appendChild(div);
  });
}

// ── Card element builder ────────────────────────────────────
function createCardElement(card) {
  const el = document.createElement("div");
  el.className = "game-card";
  const prodText = Object.entries(card.production || {})
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `+${v} ${k}`)
    .join(", ");
  const immText = Object.entries(card.immediate || {})
    .filter(([, v]) => v !== 0)
    .map(([k, v]) => `${v > 0 ? "+" : ""}${v} ${k}`)
    .join(", ");
  const startRes = Object.entries(card.starting_resources || {})
    .filter(([, v]) => v !== 0)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");

  el.innerHTML = `
    <div class="card-cost">${card.cost}</div>
    <div class="card-name">${card.name}</div>
    <span class="card-tag">${card.tag}</span>
    <span class="card-type">${card.deck || card.card_type}</span>
    <p class="card-desc">${card.description}</p>
    ${prodText ? `<div class="card-production">${prodText}</div>` : ""}
    ${immText ? `<div class="card-immediate">${immText}</div>` : ""}
    ${startRes ? `<div class="card-starting">Start: ${startRes}</div>` : ""}
  `;
  return el;
}

// ── End / Restart game ──────────────────────────────────────
endGameBtn.addEventListener("click", () => {
  if (confirm("Are you sure you want to end the game? All players will be logged out.")) {
    socket.emit("end_game");
  }
});

restartGameBtn.addEventListener("click", () => {
  if (confirm("Restart the game? Everything resets to company pick.")) {
    socket.emit("restart_game");
  }
});

// ── Actions ─────────────────────────────────────────────────
endTurnBtn.addEventListener("click", () => socket.emit("end_turn"));
endYearBtn.addEventListener("click", () => {
  if (confirm("End your fiscal year? You won't play any more cards this year.")) {
    socket.emit("end_year");
  }
});

// ── Error toast ─────────────────────────────────────────────
function showFloatingError(msg) {
  gameError.textContent = msg;
  gameError.classList.add("visible");
  setTimeout(() => gameError.classList.remove("visible"), 3000);
}
