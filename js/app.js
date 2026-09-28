(function () {
  "use strict";

  const mobileVersionElement = document.getElementById("mobile-version");

  const rules = window.LipftyRules;
  const BOARD_CELLS = rules.SIZE * rules.SIZE;
  const CORNERS = [0, 7, 56, 63];
  const ANCHOR_SQUARES = [0, 5, 30, 35];
  const ANCHOR_SETUP = [
    { index: 0, colour: "black" },
    { index: 5, colour: "white" },
    { index: 30, colour: "white" },
    { index: 35, colour: "black" }
  ];
  const STANDARD_RULES = Object.freeze({
    allowJump: true,
    allowMove: true,
    allowDiagonal: true,
    allowSquare: false,
    allowSpacedSquare: false,
    allowDiamond: false,
    allowSpacedDiamond: false
  });

  const boardElement = document.getElementById("board");
  const statusElement = document.getElementById("status");
  const currentPlayerElement = document.getElementById("current-player");
  const blackButton = document.getElementById("place-black");
  const whiteButton = document.getElementById("place-white");
  const blackRemainingElement = document.getElementById("black-remaining");
  const whiteRemainingElement = document.getElementById("white-remaining");
  const jumpControls = document.getElementById("jump-controls");
  const finishJumpButton = document.getElementById("finish-jump");
  const undoButton = document.getElementById("undo");

  // Lipfty 12: the physical reserve piece that must be played now stays on
  // the outside ring and flashes until it is actually placed.
  const activeReserveStyle = document.createElement("style");
  activeReserveStyle.textContent = `
    @keyframes lipfty-active-reserve-flash {
      from { filter: brightness(.82); box-shadow: 0 0 0 2px rgba(36,91,150,.18), 0 2px 5px rgba(0,0,0,.24); }
      to { filter: brightness(1.18); box-shadow: 0 0 0 7px rgba(36,91,150,.42), 0 0 18px rgba(36,91,150,.45), 0 2px 5px rgba(0,0,0,.24); }
    }
    .piece--active-reserve { animation: lipfty-active-reserve-flash .7s ease-in-out infinite alternate !important; }
  `;
  document.head.appendChild(activeReserveStyle);

  const COLOURS = {
    red: ["Red", "#d6423a"], blue: ["Blue", "#2d65ad"], green: ["Green", "#318653"],
    yellow: ["Yellow", "#e2ad34"], purple: ["Purple", "#7955a6"], orange: ["Orange", "#d97832"],
    black: ["Black", "#1d1d1d"], white: ["White", "#f8f8f4"]
  };

  let nextPieceId = 1;
  let state = null;
  // `settings` belongs to the game currently being played. `savedSettings`
  // belongs to the Settings wizard / next game. Keeping them separate means
  // Save can never turn an in-progress Lipfty board into Lipfty24 (or change
  // its version, colours, timer or AI) without starting a new game.
  let savedSettings = loadSettings();
  let settings = { ...savedSettings };
  let computerBusy = false;
  // App-only aid: retained only while the computer is showing its chosen action.
  // It deliberately does not participate in the rules, saved game state or AI choice.
  let computerMoveVisual = null;
  let flowTimer = null;
  let checkpoints = [];
  let clockInterval = null;
  let clockRemainingMs = [0, 0];
  let clockActivePlayer = null;
  let clockLastTick = null;
  let clockSuppressIncrementOnce = false;

  function loadSettings() {
    const defaults = {
      mode: "computer", player1: "Player", player2: "Player 2", level: "standard",
      gameFormat: "lipfty24", starter: "random", undo: true, language: "en-GB", colour1: "red", colour2: "blue",
      clockMinutes: 0, clockIncrement: 0, sound: true, animations: true, undoPreviousJump: false,
      rulesBaseline: 10,
      ...STANDARD_RULES
    };
    try {
      const saved = JSON.parse(localStorage.getItem("lipfty-settings") || "{}");
      if (saved.winLevel && saved.allowJump === undefined) {
        const level = Number(saved.winLevel) || 1;
        Object.assign(saved, {
          allowJump: level >= 2, allowMove: level >= 3, allowDiagonal: level >= 4,
          allowSquare: level >= 5, allowSpacedSquare: level >= 6,
          allowDiamond: level >= 7, allowSpacedDiamond: level >= 8
        });
      }
      delete saved.winLevel;
      // Diamonds were experimental in earlier versions and are no longer part
      // of Lipfty 8. Remove any legacy saved switches and always keep them off.
      const hadLegacyDiamondSettings = Object.prototype.hasOwnProperty.call(saved, "allowDiamond") ||
        Object.prototype.hasOwnProperty.call(saved, "allowSpacedDiamond");
      delete saved.allowDiamond;
      delete saved.allowSpacedDiamond;
      // v8.0.21 replaces the old per-move timer with an optional chess clock.
      // Existing players therefore migrate to Clock Off rather than inheriting
      // an old 30/45/60-second move limit.
      if (saved.clockMinutes === undefined) saved.clockMinutes = 0;
      if (saved.clockIncrement === undefined) saved.clockIncrement = 0;
      delete saved.timer;
      // Lipfty 11 adds Lipfty24 as a second game format. Existing players
      // remain on full Lipfty unless they explicitly choose Lipfty24.
      const needsFormatMigration = !["lipfty", "lipfty24"].includes(saved.gameFormat);
      if (needsFormatMigration) saved.gameFormat = "lipfty24";
      // Lipfty 10 introduces the Learning / Standard / Extreme version set.
      // Existing saved settings migrate safely to Standard.
      const needsRulesBaselineMigration = saved.rulesBaseline !== 10;
      if (needsRulesBaselineMigration) {
        Object.assign(saved, STANDARD_RULES, { rulesBaseline: 10 });
      }
      const migrated = { ...defaults, ...saved, allowDiamond: false, allowSpacedDiamond: false };
      if (hadLegacyDiamondSettings || needsRulesBaselineMigration || needsFormatMigration) {
        localStorage.setItem("lipfty-settings", JSON.stringify(migrated));
      }

      // Lipfty 12 startup defaults: every fresh app start opens as the full
      // Lipfty Standard game with Red / Blue pieces and the chess clock off.
      // Other preferences (player names, one/two-player mode, difficulty,
      // starter, undo, sound and animations) can still persist normally.
      return {
        ...migrated,
        // Lipfty 13.1: one game - 24 ordinary pieces, empty 6x6 start, no Opening Four or Final Four.
        gameFormat: "lipfty24",
        colour1: "red",
        colour2: "blue",
        clockMinutes: 0,
        clockIncrement: 0,
        ...STANDARD_RULES,
        rulesBaseline: 10,
        allowDiamond: false,
        allowSpacedDiamond: false
      };
    } catch (_) {
      return defaults;
    }
  }

  function saveSettings() { localStorage.setItem("lipfty-settings", JSON.stringify(savedSettings)); }
  function useSavedSettingsForNewGame() {
    settings = { ...savedSettings };
    startNewGame();
  }
  function isComputer(playerIndex) { return settings.mode === "computer" && playerIndex === 1; }
  function participantName(playerIndex) {
    if (isComputer(playerIndex)) return "Computer";
    if (settings.mode === "computer") return settings.player1 || "Player";
    return playerIndex === 0 ? (settings.player1 || "Player 1") : (settings.player2 || "Player 2");
  }
  function otherPlayer(playerIndex = state.currentPlayer) { return playerIndex === 0 ? 1 : 0; }
  function colourKey(colour) { return colour === "black" ? settings.colour1 : settings.colour2; }
  function colourTitle(colour) { return COLOURS[colourKey(colour)][0]; }
  function applyPieceColours() {
    document.documentElement.style.setProperty("--piece-black", COLOURS[settings.colour1][1]);
    document.documentElement.style.setProperty("--piece-white", COLOURS[settings.colour2][1]);
  }
  // Lipfty 13.1: Lipfty is now always the 24-piece game (formerly "Lipfty24"): the inner 6x6
  // starts empty and there is no Opening Four or Final Four. The older 32-piece code paths
  // remain in this file but are no longer reachable.
  function isLipfty24() { return true; }
  function gameFormatTitle() { return "Lipfty"; }

  function shuffled(values) {
    const result = [...values];
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function makeReserveLayout() {
    const outer = [];
    for (let i = 0; i < 64; i += 1) {
      const r = Math.floor(i / 8), c = i % 8;
      if (r === 0 || r === 7 || c === 0 || c === 7) outer.push(i);
    }
    const nonCorners = outer.filter(i => !CORNERS.includes(i));
    const active = Array(64).fill(null);
    const locked = Array(64).fill(null);

    // The Opening Four are already on the inner board. The 24
    // ordinary reserve pieces therefore occupy only the non-corner ring slots.
    shuffled([...Array(12).fill("black"), ...Array(12).fill("white")])
      .forEach((colour, i) => { active[nonCorners[i]] = colour; });

    // Full Lipfty keeps four special Final Four pieces in the physical board
    // corners. Lipfty24 uses only the 24 ordinary draughts/checkers pieces,
    // so all four physical corners remain empty throughout that game.
    if (!isLipfty24()) {
      shuffled(["black", "black", "white", "white"])
        .forEach((colour, i) => { locked[CORNERS[i]] = colour; });
    }

    return { active, locked };
  }

  function makeAutomaticAnchorBoard() {
    const board = Array(BOARD_CELLS).fill(null);
    if (isLipfty24()) return board;
    for (const anchor of ANCHOR_SETUP) {
      board[anchor.index] = { id: nextPieceId++, colour: anchor.colour, pinned: true, special: true };
    }
    return board;
  }

  function freshState() {
    return {
      board: makeAutomaticAnchorBoard(),
      reserveLayout: makeReserveLayout(),
      currentPlayer: 0,
      finalFourPhase: false,
      finalCornerPieces: [null, null, null, null],
      finalCornersPrepared: false,
      choosingColour: true,
      colourChooser: 1,
      assignedColour: null,
      selectedReserveIndex: null,
      selectedPieceIndex: null,
      legalMoves: new Set(),
      legalJumps: new Map(),
      consequence: null,
      redeployPiece: null,
      // Lipfty 13 swap rule: after the first piece of the game the other player
      // chooses whether to carry on or swap sides.
      pendingSwap: null,
      swapDone: false,
      protectedPieceId: null,
      compulsoryPlacementsRemaining: 0,
      jumpFlashIndex: null,
      winner: null,
      winReason: null,
      winningCells: []
    };
  }

  function activeReserveIndices(colour = null) {
    const result = [];
    for (let i = 0; i < 64; i += 1) {
      const c = state.reserveLayout.active[i];
      if (!c || CORNERS.includes(i) || (colour && c !== colour)) continue;
      result.push(i);
    }
    return result;
  }
  function normalReserveRemaining(colour) { return activeReserveIndices(colour).length; }
  function normalReserveTotal() { return normalReserveRemaining("black") + normalReserveRemaining("white"); }
  function normalReserveColourCount() {
    return ["black", "white"].filter(colour => normalReserveRemaining(colour) > 0).length;
  }
  function oneColourPlacementOnly() {
    return !state.finalFourPhase && !state.consequence && !state.redeployPiece &&
      normalReserveTotal() > 0 && normalReserveColourCount() === 1;
  }
  function finalCornerPiecesRemain() { return state.finalCornerPieces.some(Boolean); }
  function prepareFinalCorners() {
    if (state.finalCornersPrepared) return;
    state.finalCornerPieces = CORNERS.map(i => state.reserveLayout.locked[i]);
    state.finalCornersPrepared = true;
  }
  function beginFinalFourIfReady() {
    if (state.finalFourPhase || state.consequence || state.redeployPiece || normalReserveTotal() !== 0) return false;
    if (isLipfty24()) {
      state.winner = "draw";
      state.assignedColour = null;
      state.selectedReserveIndex = null;
      state.choosingColour = false;
      state.compulsoryPlacementsRemaining = 0;
      stopChessClockInterval();
      clockActivePlayer = null;
      clockLastTick = null;
      setStatus("Draw - all 24 pieces have been played without a win.");
      maybeShowUpdateDialog();
      return true;
    }
    prepareFinalCorners();
    state.finalFourPhase = true;
    state.assignedColour = null;
    state.selectedReserveIndex = null;
    state.choosingColour = true;
    state.colourChooser = state.currentPlayer;
    state.compulsoryPlacementsRemaining = 0;
    return true;
  }

  function moveAllowedNow() {
    return !!settings.allowMove && !state.finalFourPhase && !state.consequence &&
      !state.redeployPiece && !oneColourPlacementOnly();
  }
  function jumpAllowedNow() {
    return !!settings.allowJump && !state.finalFourPhase && !state.consequence &&
      !state.redeployPiece && !oneColourPlacementOnly();
  }

  function randomEligibleReserveIndex(colour) {
    const candidates = state.finalFourPhase
      ? CORNERS.filter((index, slot) => state.finalCornerPieces[slot] === colour)
      : activeReserveIndices(colour).filter(i => i !== state.consequence?.heldReserveIndex);
    return candidates.length ? candidates[Math.floor(Math.random() * candidates.length)] : null;
  }
  function firstFinalCornerIndex(colour) {
    const slot = state.finalCornerPieces.findIndex(c => c === colour);
    return slot >= 0 ? CORNERS[slot] : null;
  }

  function pendingJumpedPiece() {
    if (state.redeployPiece) return state.redeployPiece;
    const c = state.consequence;
    if (c && (c.type === "jump-choice" || c.type === "jump-responder-held")) return c.jumpedPiece;
    return null;
  }
  function jumpedPieceReserveDisplayIndex() {
    if (!pendingJumpedPiece()) return null;
    for (let i = 0; i < 64; i += 1) {
      const row = Math.floor(i / 8), col = i % 8;
      const outer = row === 0 || row === 7 || col === 0 || col === 7;
      if (outer && !CORNERS.includes(i) && !state.reserveLayout.active[i]) return i;
    }
    return null;
  }

  function activeReserveDisplayIndex() {
    if (state.winner !== null || state.choosingColour) return null;
    if (state.redeployPiece) return jumpedPieceReserveDisplayIndex();
    return state.selectedReserveIndex;
  }

  function clearSelection() {
    state.selectedPieceIndex = null;
    state.legalMoves = new Set();
    state.legalJumps = new Map();
  }
  function clearHeldPiece() {
    state.assignedColour = null;
    state.selectedReserveIndex = null;
    clearSelection();
  }

  function copyConsequence(c) {
    if (!c) return null;
    return { ...c, jumpedPiece: c.jumpedPiece ? { ...c.jumpedPiece } : c.jumpedPiece };
  }
  function serialiseState() {
    return {
      ...state,
      board: state.board.map(piece => piece ? { ...piece } : null),
      reserveLayout: { active: [...state.reserveLayout.active], locked: [...state.reserveLayout.locked] },
      finalCornerPieces: [...state.finalCornerPieces],
      consequence: copyConsequence(state.consequence),
      redeployPiece: state.redeployPiece ? { ...state.redeployPiece } : null,
      pendingSwap: state.pendingSwap ? { ...state.pendingSwap } : null,
      legalMoves: [], legalJumps: [], selectedPieceIndex: null
    };
  }
  function makeSnapshot() {
    settleChessClock();
    return {
      state: serialiseState(),
      nextPieceId,
      clock: { remainingMs: [...clockRemainingMs], activePlayer: clockActivePlayer }
    };
  }
  function snapshotKey(snapshot) { return JSON.stringify(snapshot.state); }
  function isHumanDecisionPoint() {
    if (!state || state.winner !== null || computerBusy) return false;
    if (state.pendingSwap) return !isComputer(state.pendingSwap.decider);
    if (state.choosingColour) return !isComputer(state.colourChooser);
    return !isComputer(state.currentPlayer);
  }
  function rememberDecisionPoint() {
    if (!settings.undo || !isHumanDecisionPoint()) return;
    const snap = makeSnapshot();
    const key = snapshotKey(snap);
    if (!checkpoints.length || checkpoints[checkpoints.length - 1].key !== key) checkpoints.push({ key, snap });
  }
  function restoreSnapshot(snap) {
    clearTimeout(flowTimer);
    computerBusy = false;
    computerMoveVisual = null;
    nextPieceId = snap.nextPieceId;
    state = {
      ...snap.state,
      board: snap.state.board.map(piece => piece ? { ...piece } : null),
      reserveLayout: { active: [...snap.state.reserveLayout.active], locked: [...snap.state.reserveLayout.locked] },
      finalCornerPieces: [...snap.state.finalCornerPieces],
      consequence: copyConsequence(snap.state.consequence),
      redeployPiece: snap.state.redeployPiece ? { ...snap.state.redeployPiece } : null,
      pendingSwap: snap.state.pendingSwap ? { ...snap.state.pendingSwap } : null,
      selectedPieceIndex: null, legalMoves: new Set(), legalJumps: new Map()
    };
    closeSwapDialog();
    restoreChessClock(snap.clock);
    clockSuppressIncrementOnce = true;
    processFlow("Previous decision restored.");
  }
  function undo() {
    if (!settings.undo || computerBusy || !checkpoints.length) return;
    const currentKey = snapshotKey(makeSnapshot());
    if (checkpoints.length && checkpoints[checkpoints.length - 1].key === currentKey) checkpoints.pop();
    if (!checkpoints.length) { render(); return; }
    restoreSnapshot(checkpoints.pop().snap);
  }

  function setStatus(text) { statusElement.textContent = text; }
  function finishWin() {
    const win = rules.checkWin(state.board, settings);
    if (!win) return false;
    state.winner = state.currentPlayer;
    state.winReason = "board";
    state.winningCells = [...win.line];
    computerBusy = false;
    computerMoveVisual = null;
    stopChessClockInterval();
    clockActivePlayer = null;
    clockLastTick = null;
    clearSelection();
    setStatus(`${participantName(state.currentPlayer)} wins with four ${colourTitle(win.colour)} pieces!`);
    render();
    maybeShowUpdateDialog();
    return true;
  }

  function availableChoiceColours() {
    if (state.consequence?.type === "jump-choice") return [state.consequence.heldColour, state.consequence.jumpedPiece.colour];
    if (state.finalFourPhase) return ["black", "white"].filter(c => firstFinalCornerIndex(c) !== null);
    const held = state.consequence?.heldReserveIndex;
    return ["black", "white"].filter(c => activeReserveIndices(c).some(i => i !== held));
  }

  function chooserIsChoosingForSelf() {
    if (state.finalFourPhase) return true;
    // Lipfty 13: after a Move or Jump the opponent chooses what they place.
    if (state.consequence?.type === "move" && state.consequence.step === 1) return true;
    if (state.consequence?.type === "jump-choice") return true;
    return false;
  }

  function chooseColour(colour, reserveIndex = null) {
    if (state.winner !== null || !state.choosingColour || computerBusy) return false;
    if (!availableChoiceColours().includes(colour)) return false;
    if (state.consequence?.type === "jump-choice") { applyJumpChoice(colour); return true; }
    let index = reserveIndex;
    if (index === null) {
      index = randomEligibleReserveIndex(colour);
    }
    if (index === null) return false;
    if (state.finalFourPhase) {
      const slot = CORNERS.indexOf(index);
      if (slot < 0 || state.finalCornerPieces[slot] !== colour) return false;
    } else {
      // A Move keeps its originally handed piece in the mover's hand.  The
      // first compulsory placement must use another physical reserve piece.
      if (CORNERS.includes(index) || state.reserveLayout.active[index] !== colour ||
          index === state.consequence?.heldReserveIndex) return false;
    }
    state.selectedReserveIndex = index;
    state.assignedColour = colour;
    state.choosingColour = false;
    clearSelection();
    processFlow();
    return true;
  }

  function autoChooseIfNoMeaningfulChoice() {
    if (!state.choosingColour) return false;
    const colours = availableChoiceColours();
    if (colours.length !== 1) return false;
    const colour = colours[0];
    // During a Move consequence the original handed piece is being held for
    // the mover's second placement.  It must never be selected for the
    // opponent's compulsory placement, even if both pieces have the same
    // colour.
    const index = randomEligibleReserveIndex(colour);
    if (index === null) return false;
    state.selectedReserveIndex = index;
    state.assignedColour = colour;
    state.choosingColour = false;
    clearSelection();
    return true;
  }

  function colourPrompt() {
    if (state.finalFourPhase) return `${participantName(state.currentPlayer)}: choose one of the remaining Final Four corner pieces to place.`;
    if (state.consequence?.type === "move" && state.consequence.step === 1) {
      return `${participantName(state.colourChooser)}: after the Move, choose the colour you will place. ${participantName(state.consequence.mover)} then places the ${colourTitle(state.consequence.heldColour)} piece they are holding.`;
    }
    if (state.consequence?.type === "jump-choice") {
      const c = state.consequence;
      return `${participantName(c.responder)}: after the Jump, choose which piece you will place - the jumped ${colourTitle(c.jumpedPiece.colour)} piece or the handed ${colourTitle(c.heldColour)} piece. ${participantName(c.jumper)} places the other one.`;
    }
    const chooser = participantName(state.colourChooser);
    const receiver = participantName(state.currentPlayer);
    return `${chooser}: choose a reserve piece/colour for ${receiver}.`;
  }

  function actionPrompt() {
    const actor = participantName(state.currentPlayer);
    if (state.redeployPiece) return `${actor}: place the jumped ${colourTitle(state.redeployPiece.colour)} piece on any empty square.`;
    if (state.consequence?.type === "jump-responder-held") return `${actor}: place the handed ${colourTitle(state.assignedColour)} piece on any empty square.`;
    if (state.finalFourPhase) return `${actor}: place the chosen Final Four ${colourTitle(state.assignedColour)} piece. No Move or Jump.`;
    if (state.consequence?.type === "move") {
      return state.consequence.step === 1 ? `${actor}: place the ${colourTitle(state.assignedColour)} piece you chose.` : `${actor}: place the piece you were originally handed.`;
    }
    if (oneColourPlacementOnly()) return `${actor}: only ${colourTitle(state.assignedColour)} remains in the normal reserve - placement only until the reserve is empty.`;
    const actions = [];
    actions.push("place the handed reserve piece");
    if (moveAllowedNow()) actions.push("Move a board piece of that colour");
    if (jumpAllowedNow()) actions.push("Jump over one opposite-colour piece");
    return `${actor}: ${actions.join(", or ")}.`;
  }

  function processFlow(message = null) {
    clearTimeout(flowTimer);
    if (state.winner !== null) { render(); return; }

    beginFinalFourIfReady();
    if (state.winner !== null) { render(); return; }

    if (state.pendingSwap) {
      const { placer, decider } = state.pendingSwap;
      setStatus(message || `${participantName(decider)}: carry on, or swap sides with ${participantName(placer)}? The first piece stays where it is.`);
      syncChessClock({ addIncrement: !clockSuppressIncrementOnce });
      clockSuppressIncrementOnce = false;
      render();
      if (isHumanDecisionPoint()) { rememberDecisionPoint(); openSwapDialog(); return; }
      flowTimer = setTimeout(computerDecideSwap, 450);
      return;
    }

    if (state.choosingColour) {
      const colours = availableChoiceColours();
      if (!colours.length) {
        state.winner = "draw";
        stopChessClockInterval();
        clockActivePlayer = null;
        clockLastTick = null;
        setStatus("Draw - no legal piece is available.");
        render();
        maybeShowUpdateDialog();
        return;
      }
      if (autoChooseIfNoMeaningfulChoice()) {
        message = `${colourTitle(state.assignedColour)} is the only available reserve colour, so the piece is selected automatically.`;
      }
    }

    if (message) setStatus(message);
    else if (state.choosingColour) setStatus(colourPrompt());
    else setStatus(actionPrompt());
    syncChessClock({ addIncrement: !clockSuppressIncrementOnce });
    clockSuppressIncrementOnce = false;
    if (state.winner !== null) return;
    render();

    if (isHumanDecisionPoint()) { rememberDecisionPoint(); return; }
    if (state.choosingColour && isComputer(state.colourChooser)) {
      flowTimer = setTimeout(computerChooseColour, 250);
      return;
    }
    if (!state.choosingColour && isComputer(state.currentPlayer)) {
      flowTimer = setTimeout(computerPlayTurn, 350);
    }
  }

  function consumeSelectedActivePiece() {
    const index = state.selectedReserveIndex;
    if (index === null || state.reserveLayout.active[index] !== state.assignedColour) return false;
    state.reserveLayout.active[index] = null;
    return true;
  }

  function startNextNormalTurn(currentPlayer, chooser, protectedPieceId = null) {
    state.currentPlayer = currentPlayer;
    state.colourChooser = chooser;
    state.protectedPieceId = protectedPieceId;
    state.consequence = null;
    state.redeployPiece = null;
    state.compulsoryPlacementsRemaining = 0;
    clearHeldPiece();
    if (!beginFinalFourIfReady()) state.choosingColour = true;
    processFlow();
  }

  function finishOrdinaryPlacement() {
    const finishingPlayer = state.currentPlayer;
    if (!state.swapDone) {
      // Swap rule: after the first piece of the game, the other player decides
      // whether to carry on or to swap sides. The piece itself never moves.
      state.swapDone = true;
      state.pendingSwap = { placer: finishingPlayer, decider: otherPlayer(finishingPlayer),
        index: state.lastPlacement?.index ?? null, colour: state.lastPlacement?.colour ?? null };
      state.protectedPieceId = null;
      state.choosingColour = false;
      clearHeldPiece();
      processFlow();
      return;
    }
    startNextNormalTurn(otherPlayer(finishingPlayer), finishingPlayer, null);
  }

  // Carry on: the placer hands the other player a piece as normal.
  // Swap: the players swap sides, so the other player now hands the placer a
  // piece and the placer takes the next turn.
  function resolveSwap(swap) {
    if (!state.pendingSwap || state.winner !== null) return;
    const { placer, decider } = state.pendingSwap;
    state.pendingSwap = null;
    state.lastSwap = { decider, swapped: !!swap };
    closeSwapDialog();
    if (swap) startNextNormalTurn(placer, decider, null);
    else startNextNormalTurn(decider, placer, null);
    if (state.winner === null) {
      const note = swap ? `${participantName(decider)} swapped sides.` : `${participantName(decider)} carries on.`;
      setStatus(`${note} ${statusElement.textContent}`);
    }
  }

  // Opening guide: for each first square and colour, how often the player who
  // placed it went on to win (per cent) in Lipfty 13 balance simulations
  // (5% mistake rate). The computer uses it for the swap decision and for its
  // own first piece. Keys: "<format>-<version>", then colour, then 6x6 index.
  const OPENING_GUIDE = {"lipfty-extreme":{"black":{"1":69,"2":47,"3":39,"4":51,"6":72,"7":67,"8":70,"9":43,"10":64,"11":47,"12":47,"13":68,"14":66,"15":64,"16":44,"17":40,"18":35,"19":46,"20":62,"21":67,"22":67,"23":48,"24":48,"25":60,"26":42,"27":69,"28":68,"29":71,"31":42,"32":32,"33":51,"34":72},"white":{"1":42,"2":34,"3":49,"4":73,"6":46,"7":63,"8":34,"9":66,"10":66,"11":69,"12":40,"13":41,"14":62,"15":63,"16":67,"17":46,"18":50,"19":67,"20":73,"21":64,"22":43,"23":36,"24":75,"25":65,"26":70,"27":45,"28":67,"29":43,"31":71,"32":50,"33":41,"34":42}},"lipfty-learning":{"black":{"1":49,"2":51,"3":36,"4":36,"6":46,"7":50,"8":59,"9":56,"10":51,"11":44,"12":49,"13":57,"14":57,"15":44,"16":62,"17":38,"18":36,"19":55,"20":49,"21":53,"22":66,"23":52,"24":30,"25":50,"26":55,"27":57,"28":52,"29":49,"31":40,"32":34,"33":51,"34":49},"white":{"1":38,"2":36,"3":51,"4":50,"6":38,"7":51,"8":56,"9":56,"10":46,"11":49,"12":35,"13":57,"14":46,"15":59,"16":64,"17":57,"18":53,"19":61,"20":54,"21":46,"22":54,"23":30,"24":47,"25":46,"26":60,"27":62,"28":49,"29":39,"31":50,"32":52,"33":35,"34":44}},"lipfty-standard":{"black":{"1":68,"2":40,"3":58,"4":58,"6":61,"7":49,"8":45,"9":44,"10":42,"11":51,"12":46,"13":47,"14":44,"15":58,"16":46,"17":61,"18":61,"19":48,"20":55,"21":47,"22":48,"23":39,"24":47,"25":43,"26":49,"27":45,"28":46,"29":65,"31":51,"32":62,"33":41,"34":62},"white":{"1":56,"2":56,"3":44,"4":68,"6":56,"7":43,"8":45,"9":48,"10":48,"11":65,"12":55,"13":46,"14":52,"15":50,"16":43,"17":39,"18":41,"19":45,"20":42,"21":54,"22":47,"23":55,"24":68,"25":46,"26":40,"27":44,"28":47,"29":56,"31":66,"32":44,"33":59,"34":51}},"lipfty24-extreme":{"black":{"0":57,"1":59,"2":55,"3":54,"4":61,"5":54,"6":63,"7":37,"8":34,"9":34,"10":32,"11":61,"12":50,"13":29,"14":31,"15":34,"16":31,"17":53,"18":60,"19":31,"20":35,"21":39,"22":36,"23":57,"24":60,"25":34,"26":33,"27":37,"28":40,"29":56,"30":57,"31":59,"32":51,"33":56,"34":55,"35":56},"white":{"0":54,"1":58,"2":52,"3":57,"4":55,"5":53,"6":62,"7":34,"8":32,"9":36,"10":33,"11":60,"12":52,"13":31,"14":36,"15":35,"16":31,"17":50,"18":50,"19":39,"20":33,"21":37,"22":35,"23":55,"24":58,"25":37,"26":37,"27":38,"28":31,"29":56,"30":53,"31":56,"32":53,"33":52,"34":59,"35":55}},"lipfty24-learning":{"black":{"0":43,"1":42,"2":52,"3":51,"4":37,"5":46,"6":44,"7":48,"8":44,"9":48,"10":47,"11":37,"12":51,"13":46,"14":45,"15":45,"16":42,"17":51,"18":48,"19":47,"20":48,"21":46,"22":52,"23":54,"24":37,"25":48,"26":47,"27":51,"28":45,"29":38,"30":48,"31":40,"32":58,"33":52,"34":41,"35":46},"white":{"0":49,"1":38,"2":51,"3":49,"4":36,"5":46,"6":38,"7":48,"8":47,"9":49,"10":45,"11":35,"12":49,"13":52,"14":48,"15":51,"16":51,"17":48,"18":51,"19":49,"20":46,"21":52,"22":51,"23":53,"24":37,"25":46,"26":56,"27":50,"28":51,"29":39,"30":42,"31":42,"32":55,"33":50,"34":43,"35":49}},"lipfty24-standard":{"black":{"0":47,"1":47,"2":50,"3":55,"4":49,"5":43,"6":46,"7":40,"8":49,"9":50,"10":40,"11":50,"12":51,"13":46,"14":48,"15":39,"16":52,"17":51,"18":49,"19":49,"20":45,"21":40,"22":52,"23":48,"24":52,"25":37,"26":49,"27":54,"28":42,"29":51,"30":43,"31":45,"32":54,"33":51,"34":49,"35":48},"white":{"0":47,"1":49,"2":51,"3":47,"4":43,"5":48,"6":53,"7":45,"8":44,"9":46,"10":41,"11":46,"12":50,"13":49,"14":45,"15":40,"16":46,"17":48,"18":45,"19":48,"20":40,"21":44,"22":41,"23":47,"24":43,"25":43,"26":49,"27":50,"28":43,"29":49,"30":45,"31":46,"32":53,"33":51,"34":47,"35":46}}};
  function currentVersionKey() {
    return settings.allowSquare ? "extreme" : (settings.allowMove || settings.allowJump) ? "standard" : "learning";
  }
  function openingGuide() {
    return OPENING_GUIDE[`${isLipfty24() ? "lipfty24" : "lipfty"}-${currentVersionKey()}`] || null;
  }
  function openingPlacerPercent(colour, index) {
    const value = openingGuide()?.[colour]?.[index];
    return typeof value === "number" ? value : null;
  }
  function isFirstPlacementOfGame() {
    return !state.swapDone && !state.pendingSwap && !state.consequence && !state.finalFourPhase && !state.redeployPiece;
  }
  function computerDecideSwap() {
    if (!state.pendingSwap || state.winner !== null || !isComputer(state.pendingSwap.decider)) return;
    const { index, colour } = state.pendingSwap;
    let swap;
    if (settings.level === "beginner") swap = Math.random() < 0.5;
    else {
      const placerPercent = colour && index !== null ? openingPlacerPercent(colour, index) : null;
      swap = placerPercent !== null && placerPercent > 50;
    }
    resolveSwap(swap);
  }

  function beginMoveConsequence(mover, movedPieceId, heldReserveIndex, heldColour) {
    const total = normalReserveTotal();
    if (total < 2) {
      // Standard Lipfty disables Move as soon as one reserve colour remains,
      // so this boundary is not reachable in normal Standard play.
      startNextNormalTurn(otherPlayer(mover), mover, movedPieceId);
      return;
    }
    const responder = otherPlayer(mover);
    state.consequence = { type: "move", step: 1, mover, responder, protectedPieceId: movedPieceId, heldReserveIndex, heldColour };
    state.currentPlayer = responder;
    // Lipfty 13: the opponent chooses the colour they place (the held colour or
    // the other colour, from the reserve). The mover then places the held piece.
    state.colourChooser = responder;
    state.protectedPieceId = movedPieceId;
    state.compulsoryPlacementsRemaining = 2;
    state.choosingColour = true;
    processFlow();
  }

  function advanceMoveConsequence() {
    const c = state.consequence;
    if (!c || c.type !== "move") return;
    if (c.step === 1) {
      c.step = 2;
      state.currentPlayer = c.mover;
      state.compulsoryPlacementsRemaining = 1;
      state.selectedReserveIndex = c.heldReserveIndex;
      state.assignedColour = c.heldColour;
      state.choosingColour = false;
      processFlow(`${participantName(c.mover)} now places the piece they were originally handed.`);
      return;
    }
    const responder = c.responder;
    const mover = c.mover;
    const protectedPieceId = c.protectedPieceId;
    startNextNormalTurn(responder, mover, protectedPieceId);
  }

  function finishRedeploy() {
    const c = state.consequence;
    const responder = c.responder;
    const jumper = c.jumper;
    const protectedPieceId = c.protectedPieceId;
    state.redeployPiece = null;
    state.currentPlayer = jumper;
    state.consequence = { type: "jump-held", jumper, responder, protectedPieceId, heldReserveIndex: c.heldReserveIndex, heldColour: c.heldColour };
    state.protectedPieceId = protectedPieceId;
    state.selectedReserveIndex = c.heldReserveIndex;
    state.assignedColour = c.heldColour;
    state.choosingColour = false;
    state.compulsoryPlacementsRemaining = 1;
    processFlow(`${participantName(jumper)} now places the piece they were originally handed.`);
  }

  function placeAt(index) {
    if (computerBusy || state.winner !== null || state.choosingColour || state.board[index]) return false;

    if (state.pendingSwap) return false;
    if (state.redeployPiece) {
      state.board[index] = state.redeployPiece;
      clearSelection();
      if (finishWin()) return true;
      if (state.consequence?.type === "jump-jumper-redeploy") {
        const c = state.consequence;
        startNextNormalTurn(c.responder, c.jumper, c.protectedPieceId);
        return true;
      }
      finishRedeploy();
      return true;
    }

    const colour = state.assignedColour;
    if (!colour || state.selectedReserveIndex === null) return false;

    if (state.finalFourPhase) {
      const slot = CORNERS.indexOf(state.selectedReserveIndex);
      if (slot < 0 || state.finalCornerPieces[slot] !== colour) return false;
      state.board[index] = { id: nextPieceId++, colour, pinned: false, special: true };
      state.finalCornerPieces[slot] = null;
      clearHeldPiece();
      if (finishWin()) return true;
      if (!finalCornerPiecesRemain()) {
        state.winner = "draw";
        stopChessClockInterval();
        clockActivePlayer = null;
        clockLastTick = null;
        setStatus("Draw - all four Final Four pieces have been placed without a win.");
        render(); maybeShowUpdateDialog(); return true;
      }
      const finishing = state.currentPlayer;
      state.currentPlayer = otherPlayer(finishing);
      state.colourChooser = state.currentPlayer;
      state.choosingColour = true;
      processFlow(); return true;
    }

    if (CORNERS.includes(state.selectedReserveIndex)) return false;
    if (!consumeSelectedActivePiece()) return false;
    state.board[index] = { id: nextPieceId++, colour, pinned: false };
    clearHeldPiece();
    if (finishWin()) return true;

    if (state.consequence?.type === "move") {
      advanceMoveConsequence();
      return true;
    }
    if (state.consequence?.type === "jump-held") {
      const c = state.consequence;
      startNextNormalTurn(c.responder, c.jumper, c.protectedPieceId);
      return true;
    }
    if (state.consequence?.type === "jump-responder-held") {
      const c = state.consequence;
      state.consequence = { ...c, type: "jump-jumper-redeploy" };
      state.redeployPiece = c.jumpedPiece;
      state.currentPlayer = c.jumper;
      state.assignedColour = c.jumpedPiece.colour;
      state.selectedReserveIndex = null;
      state.choosingColour = false;
      processFlow();
      return true;
    }

    state.lastPlacement = { index, colour };
    finishOrdinaryPlacement();
    return true;
  }

  function legalSingleJumps(from) {
    if (!jumpAllowedNow()) return [];
    const piece = state.board[from];
    if (!piece || piece.pinned) return [];
    return rules.jumpDestinations(state.board, from).filter(j => {
      const over = state.board[j.over];
      return over && !over.pinned && over.colour !== piece.colour;
    });
  }

  function selectPiece(index) {
    if (computerBusy || state.winner !== null || state.choosingColour || state.redeployPiece || state.consequence ||
        state.finalFourPhase || oneColourPlacementOnly()) return;
    const piece = state.board[index];
    if (!piece || piece.colour !== state.assignedColour) return;
    if (piece.pinned) {
      setStatus("That opening corner piece is pinned and cannot Move or Jump.");
      render(); return;
    }
    if (piece.id === state.protectedPieceId) {
      setStatus("You cannot Move or Jump the piece your opponent moved on their previous turn.");
      render(); return;
    }
    if (state.selectedPieceIndex !== null && state.selectedPieceIndex !== index) {
      setStatus("That board piece is already chosen for this turn."); render(); return;
    }
    state.selectedPieceIndex = index;
    state.legalMoves = new Set(moveAllowedNow() ? rules.adjacentDestinations(state.board, index) : []);
    state.legalJumps = new Map(legalSingleJumps(index).map(j => [j.to, j]));
    if (!state.legalMoves.size && !state.legalJumps.size) {
      clearSelection(); setStatus("That piece has no legal Move or Jump.");
    } else setStatus("Choose a highlighted destination.");
    render();
  }

  function moveBoardPiece(from, to, jump = null, afterFlash = false) {
    const piece = state.board[from];
    if (!piece || piece.pinned || state.board[to]) return;
    if (jump && !afterFlash) {
      state.jumpFlashIndex = jump.over;
      render();
      flowTimer = setTimeout(() => {
        state.jumpFlashIndex = null;
        moveBoardPiece(from, to, jump, true);
      }, settings.animations ? 400 : 0);
      return;
    }
    if (jump && state.board[jump.over]?.pinned) return;
    state.board[to] = piece;
    state.board[from] = null;
    clearSelection();
    const heldReserveIndex = state.selectedReserveIndex;
    const heldColour = state.assignedColour;

    if (finishWin()) return;

    if (!jump) {
      beginMoveConsequence(state.currentPlayer, piece.id, heldReserveIndex, heldColour);
      return;
    }

    const jumpedPiece = state.board[jump.over];
    if (!jumpedPiece || jumpedPiece.pinned || jumpedPiece.colour === piece.colour) return;
    state.board[jump.over] = null;
    const jumper = state.currentPlayer;
    const responder = otherPlayer(jumper);
    // Lipfty 13: the jumper now holds two pieces, one of each colour - the handed
    // piece and the jumped piece. The opponent chooses which one to place; the
    // jumper places the other.
    state.consequence = { type: "jump-choice", jumper, responder, protectedPieceId: piece.id, heldReserveIndex, heldColour, jumpedPiece };
    state.redeployPiece = null;
    state.currentPlayer = responder;
    state.colourChooser = responder;
    state.protectedPieceId = piece.id;
    state.assignedColour = null;
    state.selectedReserveIndex = null;
    state.choosingColour = true;
    processFlow();
  }

  function applyJumpChoice(colour) {
    const c = state.consequence;
    if (!c || c.type !== "jump-choice") return;
    state.choosingColour = false;
    state.currentPlayer = c.responder;
    clearSelection();
    if (colour === c.jumpedPiece.colour) {
      // Opponent places the jumped piece; the jumper then places the handed piece.
      state.consequence = { type: "jump-redeploy", jumper: c.jumper, responder: c.responder, protectedPieceId: c.protectedPieceId, heldReserveIndex: c.heldReserveIndex, heldColour: c.heldColour };
      state.redeployPiece = c.jumpedPiece;
      state.assignedColour = c.jumpedPiece.colour;
      state.selectedReserveIndex = null;
    } else {
      // Opponent places the handed piece; the jumper then places the jumped piece.
      state.consequence = { ...c, type: "jump-responder-held" };
      state.redeployPiece = null;
      state.selectedReserveIndex = c.heldReserveIndex;
      state.assignedColour = c.heldColour;
    }
    processFlow();
  }

  function handleCell(index) {
    if (computerBusy || state.jumpFlashIndex !== null || state.winner !== null || state.choosingColour || state.pendingSwap || isComputer(state.currentPlayer)) return;
    const piece = state.board[index];
    if (!piece && state.selectedPieceIndex !== null) {
      const from = state.selectedPieceIndex;
      if (state.legalJumps.has(index)) moveBoardPiece(from, index, state.legalJumps.get(index));
      else if (state.legalMoves.has(index)) moveBoardPiece(from, index, null);
      return;
    }
    if (!piece && state.selectedPieceIndex === null) { placeAt(index); return; }
    if (piece) selectPiece(index);
  }

  const AI_WIN_SCORE = 1000000;
  const AI_RESPONSE_LIMIT = 8;
  const AI_PLACEMENT_LIMIT = 4;
  const AI_TOP_LEVEL_LIMIT = 12;

  function cloneBoard(board) { return board.map(piece => piece ? { ...piece } : null); }

  function reserveCountsNow() {
    return { black: normalReserveRemaining("black"), white: normalReserveRemaining("white") };
  }

  function cloneCounts(counts) { return { black: counts.black || 0, white: counts.white || 0 }; }

  function decrementCount(counts, colour) {
    const next = cloneCounts(counts);
    next[colour] = Math.max(0, (next[colour] || 0) - 1);
    return next;
  }

  function availableColoursFromCounts(counts) {
    return ["black", "white"].filter(colour => Number(counts[colour] || 0) > 0);
  }

  function oneColourOnlyFromCounts(counts) {
    return availableColoursFromCounts(counts).length === 1;
  }

  function giftColoursFromCounts(counts, heldColour) {
    return ["black", "white"].filter(colour => {
      const unavailableHeldPiece = colour === heldColour ? 1 : 0;
      return Number(counts[colour] || 0) - unavailableHeldPiece > 0;
    });
  }

  let aiPatternCacheKey = null;
  let aiPatternCache = null;
  function enabledAiPatterns() {
    const key = `${!!settings.allowSquare}:${!!settings.allowSpacedSquare}`;
    if (aiPatternCacheKey === key && aiPatternCache) return aiPatternCache;
    const patterns = [...rules.WINNING_LINES];
    if (settings.allowSquare) {
      if (settings.allowSpacedSquare) patterns.push(...rules.WINNING_SQUARES);
      else {
        patterns.push(...rules.WINNING_SQUARES.filter(pattern => {
          const rows = pattern.map(i => Math.floor(i / rules.SIZE));
          const cols = pattern.map(i => i % rules.SIZE);
          return Math.max(...rows) - Math.min(...rows) === 1 && Math.max(...cols) - Math.min(...cols) === 1;
        }));
      }
    }
    aiPatternCacheKey = key;
    aiPatternCache = patterns;
    return patterns;
  }

  function boardAfterActionOn(board, action, resolveJump = false) {
    const next = cloneBoard(board);
    if (["place", "final-place", "redeploy"].includes(action.type)) {
      next[action.to] = action.piece ? { ...action.piece } : { id: -1, colour: action.colour, pinned: false };
    } else {
      next[action.to] = next[action.from];
      next[action.from] = null;
      if (resolveJump && action.type === "jump") next[action.over] = null;
    }
    return next;
  }

  function boardAfterAction(action) { return boardAfterActionOn(state.board, action, false); }

  function actionWinsOnBoard(board, action) {
    return !!rules.checkWin(boardAfterActionOn(board, action, false), settings);
  }

  function actionWins(action) { return actionWinsOnBoard(state.board, action); }

  function centreBonus(index) {
    const r = Math.floor(index / rules.SIZE), c = index % rules.SIZE;
    const rowBonus = r === 2 || r === 3 ? 2 : (r === 1 || r === 4 ? 1 : 0);
    const colBonus = c === 2 || c === 3 ? 2 : (c === 1 || c === 4 ? 1 : 0);
    return rowBonus + colBonus;
  }

  function patternPressure(board, colour, focusIndex) {
    let score = 0;
    for (const pattern of enabledAiPatterns()) {
      if (!pattern.includes(focusIndex)) continue;
      let matching = 0, blocked = false;
      for (const index of pattern) {
        const piece = board[index];
        if (!piece) continue;
        if (piece.colour !== colour) { blocked = true; break; }
        matching += 1;
      }
      if (blocked) continue;
      if (matching >= 3) score += 18;
      else if (matching === 2) score += 6;
      else if (matching === 1) score += 1.5;
    }
    return score;
  }

  function localActionHeuristic(board, action) {
    const colour = action.colour || board[action.from]?.colour;
    const after = boardAfterActionOn(board, action, false);
    if (rules.checkWin(after, settings)) return AI_WIN_SCORE;
    let score = centreBonus(action.to) * 1.5 + patternPressure(after, colour, action.to);
    if (action.type === "jump") score += 2.5;
    else if (action.type === "move") score += 0.75;
    return score;
  }

  function localJumpDestinations(board, from) {
    const piece = board[from];
    if (!piece || piece.pinned) return [];
    return rules.jumpDestinations(board, from).filter(j => {
      const over = board[j.over];
      return over && !over.pinned && over.colour !== piece.colour;
    });
  }

  function enumerateActionsOnBoard(board, colour, {
    mustPlace = false,
    protectedPieceId = null,
    reserveAvailable = true,
    allowMove = settings.allowMove,
    allowJump = settings.allowJump
  } = {}) {
    const actions = [];
    if (colour && reserveAvailable) {
      for (let to = 0; to < BOARD_CELLS; to += 1) {
        if (!board[to]) actions.push({ type: "place", to, colour });
      }
    }
    if (mustPlace) return actions;

    for (let from = 0; from < BOARD_CELLS; from += 1) {
      const piece = board[from];
      if (!piece || piece.pinned || piece.colour !== colour || piece.id === protectedPieceId) continue;
      if (allowMove) {
        for (const to of rules.adjacentDestinations(board, from)) actions.push({ type: "move", from, to, colour });
      }
      if (allowJump) {
        for (const jump of localJumpDestinations(board, from)) {
          actions.push({ type: "jump", from, to: jump.to, over: jump.over, colour });
        }
      }
    }
    return actions;
  }

  function candidateActions(board, colour, options = {}, limit = AI_RESPONSE_LIMIT) {
    const actions = enumerateActionsOnBoard(board, colour, options);
    const scored = actions.map(action => ({ action, score: localActionHeuristic(board, action) }));
    const wins = scored.filter(item => item.score >= AI_WIN_SCORE);
    if (wins.length) return wins.map(item => item.action);
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(item => item.action);
  }

  function candidatePlacements(board, colour, limit = AI_PLACEMENT_LIMIT, piece = null) {
    const actions = [];
    for (let to = 0; to < BOARD_CELLS; to += 1) {
      if (!board[to]) actions.push({ type: "place", to, colour, piece });
    }
    const scored = actions.map(action => ({ action, score: localActionHeuristic(board, action) }));
    const wins = scored.filter(item => item.score >= AI_WIN_SCORE);
    if (wins.length) return wins.map(item => item.action);
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(item => item.action);
  }

  function shallowReceiverValue(board, counts, colour, receiverIsComputer, protectedPieceId = null, forcePlacement = false) {
    const mustPlace = forcePlacement || oneColourOnlyFromCounts(counts);
    const actions = candidateActions(board, colour, {
      mustPlace,
      protectedPieceId,
      reserveAvailable: Number(counts[colour] || 0) > 0,
      allowMove: settings.allowMove && !mustPlace,
      allowJump: settings.allowJump && !mustPlace
    });
    if (!actions.length) return 0;

    const values = actions.map(action => {
      if (actionWinsOnBoard(board, action)) return receiverIsComputer ? AI_WIN_SCORE : -AI_WIN_SCORE;
      const value = localActionHeuristic(board, action);
      return receiverIsComputer ? value : -value;
    });
    return receiverIsComputer ? Math.max(...values) : Math.min(...values);
  }

  // At a normal turn boundary the chooser controls which colour the next
  // player receives. These two helpers deliberately model that Lipfty-specific
  // handover rather than treating colours as player-owned pieces.
  function futureHumanTurnUnderComputerChoice(board, counts, protectedPieceId = null, expert = false) {
    const colours = availableColoursFromCounts(counts);
    if (!colours.length) return 0;
    const values = colours.map(colour => expert
      ? expertHumanTurnValue(board, counts, colour, protectedPieceId)
      : shallowReceiverValue(board, counts, colour, false, protectedPieceId));
    return Math.max(...values);
  }

  function futureComputerTurnUnderHumanChoice(board, counts, protectedPieceId = null) {
    const colours = availableColoursFromCounts(counts);
    if (!colours.length) return 0;
    return Math.min(...colours.map(colour => shallowReceiverValue(board, counts, colour, true, protectedPieceId)));
  }

  function evaluateComputerHeldPlacement(board, counts, heldColour, protectedPieceId = null, nextHumanTurn = true, expertNext = false) {
    const afterHeldCounts = decrementCount(counts, heldColour);
    const placements = candidatePlacements(board, heldColour);
    if (!placements.length) return nextHumanTurn
      ? futureHumanTurnUnderComputerChoice(board, afterHeldCounts, protectedPieceId, expertNext)
      : futureComputerTurnUnderHumanChoice(board, afterHeldCounts, protectedPieceId);

    let best = -Infinity;
    for (const placement of placements) {
      if (actionWinsOnBoard(board, placement)) return AI_WIN_SCORE;
      const after = boardAfterActionOn(board, placement, false);
      const value = nextHumanTurn
        ? futureHumanTurnUnderComputerChoice(after, afterHeldCounts, protectedPieceId, expertNext)
        : futureComputerTurnUnderHumanChoice(after, afterHeldCounts, protectedPieceId);
      best = Math.max(best, value + localActionHeuristic(board, placement) * 0.2);
    }
    return best;
  }

  function evaluateHumanHeldPlacement(board, counts, heldColour, protectedPieceId = null) {
    const afterHeldCounts = decrementCount(counts, heldColour);
    const placements = candidatePlacements(board, heldColour);
    if (!placements.length) return futureComputerTurnUnderHumanChoice(board, afterHeldCounts, protectedPieceId);

    let worst = Infinity;
    for (const placement of placements) {
      if (actionWinsOnBoard(board, placement)) return -AI_WIN_SCORE;
      const after = boardAfterActionOn(board, placement, false);
      const value = futureComputerTurnUnderHumanChoice(after, afterHeldCounts, protectedPieceId) -
        localActionHeuristic(board, placement) * 0.2;
      worst = Math.min(worst, value);
    }
    return worst;
  }

  // A human places a specific piece (from the reserve, or a jumped piece that is
  // not counted in the reserve), then the computer takes a normal turn with the
  // human choosing its colour.
  function evaluateHumanPiecePlacement(board, counts, colour, protectedPieceId, fromReserve, piece = null) {
    const afterCounts = fromReserve ? decrementCount(counts, colour) : counts;
    const placements = candidatePlacements(board, colour, AI_PLACEMENT_LIMIT, piece);
    if (!placements.length) return futureComputerTurnUnderHumanChoice(board, afterCounts, protectedPieceId);
    let worst = Infinity;
    for (const placement of placements) {
      if (actionWinsOnBoard(board, placement)) return -AI_WIN_SCORE;
      const after = boardAfterActionOn(board, placement, false);
      worst = Math.min(worst, futureComputerTurnUnderHumanChoice(after, afterCounts, protectedPieceId) - localActionHeuristic(board, placement) * 0.2);
    }
    return worst;
  }
  // The computer places a specific piece, then the human takes a normal turn with
  // the computer choosing their colour.
  function evaluateComputerPiecePlacement(board, counts, colour, protectedPieceId, fromReserve, piece = null, expertNext = false) {
    const afterCounts = fromReserve ? decrementCount(counts, colour) : counts;
    const placements = candidatePlacements(board, colour, AI_PLACEMENT_LIMIT, piece);
    if (!placements.length) return futureHumanTurnUnderComputerChoice(board, afterCounts, protectedPieceId, expertNext);
    let best = -Infinity;
    for (const placement of placements) {
      if (actionWinsOnBoard(board, placement)) return AI_WIN_SCORE;
      const after = boardAfterActionOn(board, placement, false);
      best = Math.max(best, futureHumanTurnUnderComputerChoice(after, afterCounts, protectedPieceId, expertNext) + localActionHeuristic(board, placement) * 0.2);
    }
    return best;
  }

  // Computer responds to a human Move: it chooses the colour it places.
  function computerMoveResponseColour(colours) {
    const c = state.consequence, counts = reserveCountsNow();
    let best = colours[0], bestValue = -Infinity;
    for (const colour of colours) {
      const afterCounts = decrementCount(counts, colour);
      let value = -Infinity;
      for (const placement of candidatePlacements(state.board, colour)) {
        if (actionWinsOnBoard(state.board, placement)) { value = AI_WIN_SCORE; break; }
        const after = boardAfterActionOn(state.board, placement, false);
        value = Math.max(value, evaluateHumanHeldPlacement(after, afterCounts, c.heldColour, c.protectedPieceId) + localActionHeuristic(state.board, placement) * 0.15);
      }
      if (value === -Infinity) value = 0;
      value += Math.random() * 0.01;
      if (value > bestValue) { bestValue = value; best = colour; }
    }
    return best;
  }

  // Computer responds to a human Jump: place the jumped piece (A) or the handed piece (B).
  function computerJumpChoiceColour() {
    const c = state.consequence, counts = reserveCountsNow(), board = state.board;
    const jumped = c.jumpedPiece;
    let valueA = -Infinity;
    for (const placement of candidatePlacements(board, jumped.colour, AI_PLACEMENT_LIMIT, jumped)) {
      if (actionWinsOnBoard(board, placement)) { valueA = AI_WIN_SCORE; break; }
      const after = boardAfterActionOn(board, placement, false);
      valueA = Math.max(valueA, evaluateHumanHeldPlacement(after, counts, c.heldColour, c.protectedPieceId) + localActionHeuristic(board, placement) * 0.15);
    }
    let valueB = -Infinity;
    const afterHeldCounts = decrementCount(counts, c.heldColour);
    for (const placement of candidatePlacements(board, c.heldColour)) {
      if (actionWinsOnBoard(board, placement)) { valueB = AI_WIN_SCORE; break; }
      const after = boardAfterActionOn(board, placement, false);
      valueB = Math.max(valueB, evaluateHumanPiecePlacement(after, afterHeldCounts, jumped.colour, c.protectedPieceId, false, jumped) + localActionHeuristic(board, placement) * 0.15);
    }
    if (settings.level === "beginner") return Math.random() < 0.5 ? jumped.colour : c.heldColour;
    return valueB > valueA ? c.heldColour : jumped.colour;
  }

  function computerMoveGiftValue(boardAfterMove, counts, heldColour, giftColour, protectedPieceId, expert = true) {
    const afterGiftCounts = decrementCount(counts, giftColour);
    const humanPlacements = candidatePlacements(boardAfterMove, giftColour, expert ? AI_PLACEMENT_LIMIT : 5);
    if (!humanPlacements.length) return evaluateComputerHeldPlacement(boardAfterMove, afterGiftCounts, heldColour, protectedPieceId, true);

    let worst = Infinity;
    for (const placement of humanPlacements) {
      if (actionWinsOnBoard(boardAfterMove, placement)) return -AI_WIN_SCORE;
      const afterHuman = boardAfterActionOn(boardAfterMove, placement, false);
      const value = evaluateComputerHeldPlacement(afterHuman, afterGiftCounts, heldColour, protectedPieceId, true, false);
      worst = Math.min(worst, value - localActionHeuristic(boardAfterMove, placement) * 0.15);
    }
    return worst;
  }

  function evaluateComputerMoveConsequence(board, action, counts, heldColour, expert = true) {
    const movedPieceId = board[action.from]?.id ?? null;
    const afterMove = boardAfterActionOn(board, action, false);
    const gifts = giftColoursFromCounts(counts, heldColour);
    if (!gifts.length) return localActionHeuristic(board, action);
    // Lipfty 13: the human responder chooses the colour, so assume the worst.
    return Math.min(...gifts.map(giftColour =>
      computerMoveGiftValue(afterMove, counts, heldColour, giftColour, movedPieceId, expert)));
  }

  function evaluateComputerJumpConsequence(board, action, counts, heldColour, expert = true) {
    const jumpedPiece = board[action.over];
    const movedPieceId = board[action.from]?.id ?? null;
    if (!jumpedPiece) return -AI_WIN_SCORE / 2;
    const afterJump = boardAfterActionOn(board, action, true);
    const humanRedeployments = candidatePlacements(afterJump, jumpedPiece.colour, expert ? AI_PLACEMENT_LIMIT : 5, jumpedPiece);
    if (!humanRedeployments.length) return evaluateComputerHeldPlacement(afterJump, counts, heldColour, movedPieceId, true);

    let worst = Infinity;
    for (const redeploy of humanRedeployments) {
      if (actionWinsOnBoard(afterJump, redeploy)) return -AI_WIN_SCORE;
      const afterRedeploy = boardAfterActionOn(afterJump, redeploy, false);
      const value = evaluateComputerHeldPlacement(afterRedeploy, counts, heldColour, movedPieceId, true, false);
      worst = Math.min(worst, value - localActionHeuristic(afterJump, redeploy) * 0.15);
    }
    // Lipfty 13: the human may instead place the handed colour, leaving the
    // computer to place the jumped piece. The human picks whichever is worse for us.
    const afterHeldCounts = decrementCount(counts, heldColour);
    for (const placement of candidatePlacements(afterJump, heldColour, expert ? AI_PLACEMENT_LIMIT : 5)) {
      if (actionWinsOnBoard(afterJump, placement)) return -AI_WIN_SCORE;
      const afterHuman = boardAfterActionOn(afterJump, placement, false);
      const value = evaluateComputerPiecePlacement(afterHuman, afterHeldCounts, jumpedPiece.colour, movedPieceId, false, jumpedPiece);
      worst = Math.min(worst, value - localActionHeuristic(afterJump, placement) * 0.15);
    }
    return worst;
  }

  function evaluateHumanMoveConsequence(board, action, counts, heldColour) {
    const movedPieceId = board[action.from]?.id ?? null;
    const afterMove = boardAfterActionOn(board, action, false);
    const gifts = giftColoursFromCounts(counts, heldColour);
    if (!gifts.length) return -localActionHeuristic(board, action);

    // Lipfty 13: the computer responder chooses its own colour, so take the best.
    let humanChoice = -Infinity;
    for (const giftColour of gifts) {
      const afterGiftCounts = decrementCount(counts, giftColour);
      const computerPlacements = candidatePlacements(afterMove, giftColour);
      let computerBest = -Infinity;
      for (const placement of computerPlacements) {
        if (actionWinsOnBoard(afterMove, placement)) { computerBest = AI_WIN_SCORE; break; }
        const afterComputer = boardAfterActionOn(afterMove, placement, false);
        const value = evaluateHumanHeldPlacement(afterComputer, afterGiftCounts, heldColour, movedPieceId);
        computerBest = Math.max(computerBest, value + localActionHeuristic(afterMove, placement) * 0.15);
      }
      if (computerBest === -Infinity) computerBest = evaluateHumanHeldPlacement(afterMove, afterGiftCounts, heldColour, movedPieceId);
      humanChoice = Math.max(humanChoice, computerBest);
    }
    return humanChoice;
  }

  function evaluateHumanJumpConsequence(board, action, counts, heldColour) {
    const jumpedPiece = board[action.over];
    const movedPieceId = board[action.from]?.id ?? null;
    if (!jumpedPiece) return 0;
    const afterJump = boardAfterActionOn(board, action, true);

    // The computer redeploys the exact jumped piece and therefore chooses the
    // best redeployment square before the human jumper must place the held piece.
    const computerRedeployments = candidatePlacements(afterJump, jumpedPiece.colour, AI_PLACEMENT_LIMIT, jumpedPiece);
    let computerBest = -Infinity;
    for (const redeploy of computerRedeployments) {
      if (actionWinsOnBoard(afterJump, redeploy)) return AI_WIN_SCORE;
      const afterRedeploy = boardAfterActionOn(afterJump, redeploy, false);
      const value = evaluateHumanHeldPlacement(afterRedeploy, counts, heldColour, movedPieceId);
      computerBest = Math.max(computerBest, value + localActionHeuristic(afterJump, redeploy) * 0.15);
    }
    // Lipfty 13: the computer may instead place the handed colour, leaving the
    // human jumper to place the jumped piece.
    const afterHeldCounts = decrementCount(counts, heldColour);
    for (const placement of candidatePlacements(afterJump, heldColour)) {
      if (actionWinsOnBoard(afterJump, placement)) return AI_WIN_SCORE;
      const afterComputer = boardAfterActionOn(afterJump, placement, false);
      const value = evaluateHumanPiecePlacement(afterComputer, afterHeldCounts, jumpedPiece.colour, movedPieceId, false, jumpedPiece);
      computerBest = Math.max(computerBest, value + localActionHeuristic(afterJump, placement) * 0.15);
    }
    return computerBest === -Infinity ? evaluateHumanHeldPlacement(afterJump, counts, heldColour, movedPieceId) : computerBest;
  }

  function expertHumanTurnValue(board, counts, colour, protectedPieceId = null) {
    const mustPlace = oneColourOnlyFromCounts(counts);
    const actions = candidateActions(board, colour, {
      mustPlace,
      protectedPieceId,
      reserveAvailable: Number(counts[colour] || 0) > 0,
      allowMove: settings.allowMove && !mustPlace,
      allowJump: settings.allowJump && !mustPlace
    });
    if (!actions.length) return 0;

    let worst = Infinity;
    for (const action of actions) {
      if (actionWinsOnBoard(board, action)) return -AI_WIN_SCORE;
      let value;
      if (action.type === "place") {
        const after = boardAfterActionOn(board, action, false);
        const afterCounts = decrementCount(counts, colour);
        value = futureComputerTurnUnderHumanChoice(after, afterCounts, null) - localActionHeuristic(board, action) * 0.25;
      } else if (action.type === "move") {
        value = evaluateHumanMoveConsequence(board, action, counts, colour);
      } else {
        value = evaluateHumanJumpConsequence(board, action, counts, colour);
      }
      worst = Math.min(worst, value);
    }
    return worst;
  }

  function standardActionScore(action) {
    const board = state.board;
    if (actionWinsOnBoard(board, action)) return AI_WIN_SCORE;
    const counts = reserveCountsNow();
    let value = localActionHeuristic(board, action);

    const c = state.consequence;
    if (action.type === "redeploy") {
      const after = boardAfterActionOn(board, action, false);
      if (c?.type === "jump-redeploy") value += evaluateHumanHeldPlacement(after, counts, c.heldColour, c.protectedPieceId) * 0.8;
      else if (c?.type === "jump-jumper-redeploy") value += futureHumanTurnUnderComputerChoice(after, counts, c.protectedPieceId, false) * 0.8;
    } else if (action.type === "place") {
      const after = boardAfterActionOn(board, action, false);
      const afterCounts = decrementCount(counts, action.colour);
      if (c?.type === "move" && c.step === 1) value += evaluateHumanHeldPlacement(after, afterCounts, c.heldColour, c.protectedPieceId) * 0.8;
      else if (c?.type === "jump-responder-held") value += evaluateHumanPiecePlacement(after, afterCounts, c.jumpedPiece.colour, c.protectedPieceId, false, c.jumpedPiece) * 0.8;
      else value += futureHumanTurnUnderComputerChoice(after, afterCounts, c?.protectedPieceId ?? null, false) * 0.8;
    } else if (action.type === "move") {
      value += evaluateComputerMoveConsequence(board, action, counts, state.assignedColour, false) * 0.7;
    } else if (action.type === "jump") {
      value += evaluateComputerJumpConsequence(board, action, counts, state.assignedColour, false) * 0.7;
    }
    return value + Math.random() * 0.35;
  }

  function expertActionScore(action) {
    const board = state.board;
    if (actionWinsOnBoard(board, action)) return AI_WIN_SCORE;
    const counts = reserveCountsNow();
    let value = localActionHeuristic(board, action) * 0.35;

    if (state.redeployPiece && action.type === "redeploy") {
      const c = state.consequence;
      if (!c) return value;
      const after = boardAfterActionOn(board, action, false);
      if (actionWinsOnBoard(board, action)) return AI_WIN_SCORE;
      if (c.type === "jump-jumper-redeploy") return futureHumanTurnUnderComputerChoice(after, counts, c.protectedPieceId, true) + value;
      return evaluateHumanHeldPlacement(after, counts, c.heldColour, c.protectedPieceId) + value;
    }

    if (action.type === "place") {
      const after = boardAfterActionOn(board, action, false);
      const afterCounts = decrementCount(counts, action.colour);

      if (state.consequence?.type === "move" && state.consequence.step === 1) {
        // Computer is the responder to a human Move. After this compulsory
        // placement the human mover must place the originally held piece.
        return evaluateHumanHeldPlacement(after, afterCounts, state.consequence.heldColour, state.consequence.protectedPieceId) + value;
      }

      if (state.consequence?.type === "move" && state.consequence.step === 2) {
        return futureHumanTurnUnderComputerChoice(after, afterCounts, state.consequence.protectedPieceId, true) + value;
      }

      if (state.consequence?.type === "jump-held") {
        return futureHumanTurnUnderComputerChoice(after, afterCounts, state.consequence.protectedPieceId, true) + value;
      }

      if (state.consequence?.type === "jump-responder-held") {
        const c = state.consequence;
        return evaluateHumanPiecePlacement(after, afterCounts, c.jumpedPiece.colour, c.protectedPieceId, false, c.jumpedPiece) + value;
      }

      if (state.finalFourPhase) return value;
      return futureHumanTurnUnderComputerChoice(after, afterCounts, null, true) + value;
    }

    if (action.type === "move") {
      return evaluateComputerMoveConsequence(board, action, counts, state.assignedColour, true) + value;
    }
    if (action.type === "jump") {
      return evaluateComputerJumpConsequence(board, action, counts, state.assignedColour, true) + value;
    }
    return value;
  }

  function actionScore(action) {
    if (settings.level === "expert") return expertActionScore(action);
    return standardActionScore(action);
  }

  function pickComputerAction(actions) {
    if (!actions.length) return null;
    const wins = actions.filter(actionWins);
    if (!wins.length && isFirstPlacementOfGame() && settings.level !== "beginner" && openingGuide()) {
      // Swap rule: a lopsided first piece is punished, so pick one of the fairest squares.
      const scored = actions.filter(a => a.type === "place").map(a => {
        const p = openingPlacerPercent(a.colour, a.to);
        return { a, fair: p === null ? -1 : Math.min(p, 100 - p) };
      });
      if (scored.length) {
        const top = Math.max(...scored.map(x => x.fair));
        const pool = scored.filter(x => x.fair >= top - 3);
        return pool[Math.floor(Math.random() * pool.length)].a;
      }
    }
    if (wins.length) return wins[Math.floor(Math.random() * wins.length)];
    if (settings.level === "beginner") return actions[Math.floor(Math.random() * actions.length)];

    // Expert does its expensive look-ahead only on the strongest tactical
    // candidates. This keeps the phone responsive while still considering
    // every immediate win before pruning. Standard remains cheap enough to
    // score every legal action.
    const candidates = settings.level === "expert"
      ? actions
          .map(action => ({ action, score: localActionHeuristic(state.board, action) }))
          .sort((a, b) => b.score - a.score)
          .slice(0, AI_TOP_LEVEL_LIMIT)
          .map(item => item.action)
      : actions;
    return candidates
      .map(action => ({ action, score: actionScore(action) }))
      .sort((a, b) => b.score - a.score)[0].action;
  }

  function enumerateActions(colour, mustPlace = false) {
    return enumerateActionsOnBoard(state.board, colour, {
      mustPlace,
      protectedPieceId: state.protectedPieceId,
      reserveAvailable: colour ? normalReserveRemaining(colour) > 0 : false,
      allowMove: moveAllowedNow(),
      allowJump: jumpAllowedNow()
    });
  }

  function bestSelfChoiceColour(colours) {
    let bestColour = colours[0], bestValue = -Infinity;
    for (const colour of colours) {
      const placements = candidatePlacements(state.board, colour);
      let value = -Infinity;
      for (const placement of placements) {
        if (actionWinsOnBoard(state.board, placement)) { value = AI_WIN_SCORE; break; }
        value = Math.max(value, localActionHeuristic(state.board, placement));
      }
      if (value > bestValue) { bestValue = value; bestColour = colour; }
    }
    return bestColour;
  }

  function chooseComputerHandoverColour(colours) {
    if (!colours.length) return null;
    if (state.consequence?.type === "move" && state.consequence.step === 1) return computerMoveResponseColour(colours);
    if (state.consequence?.type === "jump-choice") return computerJumpChoiceColour();
    if (isFirstPlacementOfGame() && settings.level !== "beginner" && openingGuide() && colours.length > 1) {
      // Swap rule: hand the colour whose fairest opening is least fair.
      const guide = openingGuide();
      const fairest = c => Math.max(...Object.values(guide[c] || {}).map(p => Math.min(p, 100 - p)), 0);
      const ranked = colours.map(c => ({ c, v: fairest(c) + Math.random() * 0.5 })).sort((a, b) => a.v - b.v);
      return ranked[0].c;
    }
    if (chooserIsChoosingForSelf()) {
      // Even Beginner takes an immediately visible win; otherwise Beginner
      // remains deliberately loose while Standard/Expert choose tactically.
      const winning = colours.filter(colour => candidatePlacements(state.board, colour).some(p => actionWinsOnBoard(state.board, p)));
      if (winning.length) return winning[Math.floor(Math.random() * winning.length)];
      return settings.level === "beginner"
        ? colours[Math.floor(Math.random() * colours.length)]
        : bestSelfChoiceColour(colours);
    }

    if (settings.level === "beginner") return colours[Math.floor(Math.random() * colours.length)];

    const counts = reserveCountsNow();
    let bestColour = colours[0], bestValue = -Infinity;
    for (const colour of colours) {
      let value;
      if (state.consequence?.type === "move" && state.consequence.step === 1 && state.consequence.mover === 1) {
        value = computerMoveGiftValue(
          state.board,
          counts,
          state.consequence.heldColour,
          colour,
          state.consequence.protectedPieceId,
          settings.level === "expert"
        );
      } else if (settings.level === "expert") {
        value = expertHumanTurnValue(state.board, counts, colour, state.protectedPieceId);
      } else {
        value = shallowReceiverValue(state.board, counts, colour, false, state.protectedPieceId);
      }
      if (value > bestValue) { bestValue = value; bestColour = colour; }
    }
    return bestColour;
  }

  function computerChooseColour() {
    if (state.winner !== null || !state.choosingColour || !isComputer(state.colourChooser)) return;
    computerBusy = true; render();
    const colours = availableChoiceColours();
    if (!colours.length) { computerBusy = false; processFlow(); return; }

    const colour = chooseComputerHandoverColour(colours);
    if (state.consequence?.type === "jump-choice") {
      flowTimer = setTimeout(() => { computerBusy = false; applyJumpChoice(colour); }, 250);
      return;
    }
    const index = randomEligibleReserveIndex(colour);
    flowTimer = setTimeout(() => {
      computerBusy = false;
      state.selectedReserveIndex = index;
      state.assignedColour = colour;
      state.choosingColour = false;
      clearSelection();
      processFlow();
    }, 200);
  }

  function computerPlayTurn() {
    if (state.winner !== null || state.choosingColour || !isComputer(state.currentPlayer)) return;
    computerBusy = true; setStatus("Computer is thinking..."); render();
    let actions = [];
    if (state.redeployPiece) {
      for (let to = 0; to < BOARD_CELLS; to += 1) if (!state.board[to]) actions.push({ type: "redeploy", to, colour: state.redeployPiece.colour });
    } else if (state.finalFourPhase) {
      for (let to = 0; to < BOARD_CELLS; to += 1) if (!state.board[to]) actions.push({ type: "final-place", to, colour: state.assignedColour });
    } else {
      actions = enumerateActions(state.assignedColour, !!state.consequence);
    }
    const action = pickComputerAction(actions);
    if (!action) { computerBusy = false; processFlow("Computer has no legal action."); return; }
    const actionName = action.type === "final-place" ? "place a Final Four piece" :
      action.type === "redeploy" ? "redeploy the jumped piece" :
      action.type === "place" ? "place a piece" : action.type === "jump" ? "Jump" : "Move";
    computerMoveVisual = {
      type: action.type,
      from: action.from ?? null,
      to: action.to,
      over: action.over ?? null
    };
    setStatus(`Computer will ${actionName}.`);
    render();
    flowTimer = setTimeout(() => {
      computerBusy = false;
      computerMoveVisual = null;
      if (["place", "final-place", "redeploy"].includes(action.type)) { placeAt(action.to); return; }
      const jump = action.type === "jump" ? { to: action.to, over: action.over } : null;
      // Retain the established, separate flash of the jumped piece after the
      // arrow has identified the computer's starting square and destination.
      moveBoardPiece(action.from, action.to, jump, false);
    }, settings.animations ? 650 : 0);
  }

  function chooseReservePiece(displayIndex, colour) {
    if (state.winner !== null || computerBusy || !state.choosingColour || isComputer(state.colourChooser)) return;
    if (!availableChoiceColours().includes(colour)) return;
    if (state.consequence?.type === "jump-choice") { applyJumpChoice(colour); return; }
    if (state.finalFourPhase) {
      const slot = CORNERS.indexOf(displayIndex);
      if (slot < 0 || state.finalCornerPieces[slot] !== colour) return;
    } else {
      if (CORNERS.includes(displayIndex) || state.reserveLayout.active[displayIndex] !== colour ||
          displayIndex === state.consequence?.heldReserveIndex) return;
    }
    chooseColour(colour, displayIndex);
  }

  // On a phone the compact colour cards are the clearest way to make the
  // choice. Selecting one chooses uniformly from every eligible physical
  // reserve piece of that colour, so the outer ring empties naturally.
  function chooseReserveColourFromPanel(colour) {
    if (state.winner !== null || computerBusy || !state.choosingColour || isComputer(state.colourChooser)) return;
    if (!availableChoiceColours().includes(colour)) return;
    if (state.consequence?.type === "jump-choice") { applyJumpChoice(colour); return; }
    const index = randomEligibleReserveIndex(colour);
    chooseColour(colour, index);
  }

  function renderBoard() {
    boardElement.replaceChildren();
    const winning = new Set(state.winningCells);
    const activeOuterIndex = activeReserveDisplayIndex();
    const jumpedOuterPiece = pendingJumpedPiece();
    const jumpedOuterIndex = jumpedOuterPiece ? jumpedPieceReserveDisplayIndex() : null;
    for (let displayIndex = 0; displayIndex < 64; displayIndex += 1) {
      const dr = Math.floor(displayIndex / 8), dc = displayIndex % 8;
      const inner = dr >= 1 && dr <= 6 && dc >= 1 && dc <= 6;
      const cell = document.createElement("button");
      cell.type = "button"; cell.setAttribute("role", "gridcell");
      if (!inner) {
        cell.className = "board-cell board-cell--reserve";
        cell.classList.add((dr + dc) % 2 ? "board-cell--sq-dark" : "board-cell--sq-light");
        const corner = CORNERS.includes(displayIndex);
        const activeColour = state.reserveLayout.active[displayIndex];
        const slot = corner ? CORNERS.indexOf(displayIndex) : -1;
        const finalAvailable = corner && state.finalCornersPrepared ? state.finalCornerPieces[slot] : state.reserveLayout.locked[displayIndex];
        let visiblePiece = null;

        // A selected reserve piece is no longer hidden immediately. It stays
        // in its physical outer-ring position until placeAt() actually uses it.
        if (corner && finalAvailable) {
          const marker = document.createElement("span");
          marker.className = `piece piece--${finalAvailable} piece--locked-corner piece--special-square`;
          marker.setAttribute("aria-hidden", "true");
          cell.appendChild(marker);
          visiblePiece = marker;
        } else if (activeColour) {
          const disc = document.createElement("span");
          disc.className = `piece piece--${activeColour}`;
          disc.setAttribute("aria-hidden", "true");
          cell.appendChild(disc);
          visiblePiece = disc;
        } else if (!corner && jumpedOuterIndex === displayIndex && jumpedOuterPiece) {
          // The exact jumped piece is temporarily shown in a free outside-ring
          // space while it waits to be placed again.
          const disc = document.createElement("span");
          disc.className = `piece piece--${jumpedOuterPiece.colour}`;
          disc.setAttribute("aria-hidden", "true");
          cell.appendChild(disc);
          visiblePiece = disc;
        } else if (!corner) {
          cell.classList.add("board-cell--reserve-empty");
        }

        if (visiblePiece && activeOuterIndex === displayIndex) {
          visiblePiece.classList.add("piece--active-reserve");
          cell.setAttribute("aria-current", "true");
        }
        // Jump choice: highlight the two pieces the opponent chooses between.
        if (visiblePiece && state.consequence?.type === "jump-choice" && state.winner === null &&
            (displayIndex === state.consequence.heldReserveIndex || displayIndex === jumpedOuterIndex)) {
          visiblePiece.classList.add("piece--active-reserve");
        }

        let selectable = null;
        const humanChooser = state.winner === null && state.choosingColour && !computerBusy && !isComputer(state.colourChooser);
        if (humanChooser && state.consequence?.type === "jump-choice") {
          const c = state.consequence;
          if (displayIndex === c.heldReserveIndex) selectable = c.heldColour;
          else if (displayIndex === jumpedOuterIndex) selectable = c.jumpedPiece.colour;
        } else if (humanChooser) {
          if (state.finalFourPhase && corner && state.finalCornerPieces[slot]) selectable = state.finalCornerPieces[slot];
          else if (!state.finalFourPhase && !corner && activeColour) selectable = activeColour;
        }
        cell.disabled = !selectable;
        if (selectable) {
          cell.classList.add("board-cell--reserve-selectable");
          cell.addEventListener("click", () => chooseReservePiece(displayIndex, selectable));
        }
        boardElement.appendChild(cell); continue;
      }

      const row = dr - 1, col = dc - 1, index = row * rules.SIZE + col;
      cell.className = "board-cell board-cell--playing"; cell.dataset.index = String(index);
      cell.classList.add((dr + dc) % 2 ? "board-cell--sq-dark" : "board-cell--sq-light");
      if (winning.has(index)) cell.classList.add("board-cell--winner");
      if (state.selectedPieceIndex === index) cell.classList.add("board-cell--selected");
      if (state.legalMoves.has(index)) cell.classList.add("board-cell--move");
      if (state.legalJumps.has(index)) cell.classList.add("board-cell--jump");
      if (state.jumpFlashIndex === index) cell.classList.add("board-cell--jumped-flash");
      if (computerMoveVisual?.from === index) cell.classList.add("board-cell--computer-source");
      if (computerMoveVisual?.to === index) cell.classList.add("board-cell--computer-target");
      if (computerMoveVisual?.type === "jump" && computerMoveVisual.to === index) cell.classList.add("board-cell--computer-jump-target");
      if (computerMoveVisual?.type === "jump" && computerMoveVisual.over === index) cell.classList.add("board-cell--computer-jumped");
      if (!state.board[index] && !state.choosingColour && !computerBusy && !isComputer(state.currentPlayer) && state.selectedPieceIndex === null) {
        if (state.redeployPiece || state.finalFourPhase || state.selectedReserveIndex !== null) cell.classList.add("board-cell--place");
      }
      const piece = state.board[index];
      if (piece) {
        const disc = document.createElement("span");
        disc.className = `piece piece--${piece.colour}${piece.special ? " piece--special-square" : ""}`;
        disc.setAttribute("aria-hidden", "true");
        cell.appendChild(disc);
        const pieceRole = piece.pinned ? " pinned opening anchor" : piece.special ? " special Final Four piece" : " piece";
        cell.setAttribute("aria-label", `${colourTitle(piece.colour)}${pieceRole}, row ${row + 1}, column ${col + 1}`);
      } else cell.setAttribute("aria-label", `Empty playing square, row ${row + 1}, column ${col + 1}`);
      cell.disabled = computerBusy;
      cell.addEventListener("click", () => handleCell(index));
      boardElement.appendChild(cell);
    }
    renderComputerMoveArrow();
  }

  function renderComputerMoveArrow() {
    if (!computerMoveVisual || computerMoveVisual.from === null || computerMoveVisual.to === null) return;
    const from = boardElement.querySelector(`[data-index="${computerMoveVisual.from}"]`);
    const to = boardElement.querySelector(`[data-index="${computerMoveVisual.to}"]`);
    if (!from || !to) return;
    const boardRect = boardElement.getBoundingClientRect();
    const fromRect = from.getBoundingClientRect();
    const toRect = to.getBoundingClientRect();
    const x1 = fromRect.left + fromRect.width / 2 - boardRect.left;
    const y1 = fromRect.top + fromRect.height / 2 - boardRect.top;
    const x2 = toRect.left + toRect.width / 2 - boardRect.left;
    const y2 = toRect.top + toRect.height / 2 - boardRect.top;
    const dx = x2 - x1, dy = y2 - y1;
    const arrow = document.createElement("span");
    arrow.className = `computer-move-arrow${computerMoveVisual.type === "jump" ? " computer-move-arrow--jump" : ""}`;
    arrow.setAttribute("aria-hidden", "true");
    arrow.style.left = `${x1}px`;
    arrow.style.top = `${y1}px`;
    arrow.style.width = `${Math.hypot(dx, dy)}px`;
    arrow.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
    boardElement.appendChild(arrow);
    if (computerMoveVisual.type === "jump") {
      const label = document.createElement("span");
      label.className = "computer-jump-label";
      label.textContent = "JUMP!";
      label.setAttribute("aria-hidden", "true");
      label.style.left = `${(x1 + x2) / 2}px`;
      label.style.top = `${(y1 + y2) / 2}px`;
      boardElement.appendChild(label);
    }
  }

  function activeColourTotal(colour) {
    return state.reserveLayout.active.filter(c => c === colour).length;
  }
  function render() {
    maybeRecordResult();
    const decisionActor = decisionActorIndex();
    currentPlayerElement.textContent = state.winner === "draw" ? "Draw" : state.winner !== null ? `${participantName(state.winner)} wins` : participantName(decisionActor ?? state.currentPlayer);
    const decisionLabel = currentPlayerElement.closest(".player-status-card")?.querySelector(".turn-label");
    if (decisionLabel) {
      if (state.winner !== null) decisionLabel.textContent = "Result";
      else decisionLabel.textContent = decisionActor !== state.currentPlayer ? "Decision by" : "Current turn";
    }
    renderChessClocks();
    blackRemainingElement.textContent = state.finalFourPhase ? `${state.finalCornerPieces.filter(c => c === "black").length} final remaining` : `${activeColourTotal("black")} remaining`;
    whiteRemainingElement.textContent = state.finalFourPhase ? `${state.finalCornerPieces.filter(c => c === "white").length} final remaining` : `${activeColourTotal("white")} remaining`;
    blackButton.querySelector(".piece")?.classList.toggle("piece--special-square", state.finalFourPhase && !isLipfty24());
    whiteButton.querySelector(".piece")?.classList.toggle("piece--special-square", state.finalFourPhase && !isLipfty24());
    boardElement.setAttribute("aria-label", `${gameFormatTitle()} eight by eight board with inner six by six playing area`);
    document.getElementById("colour1-name").textContent = COLOURS[settings.colour1][0];
    document.getElementById("colour2-name").textContent = COLOURS[settings.colour2][0];

    const phaseHelp = document.getElementById("phase-help");
    if (phaseHelp) {
      phaseHelp.textContent = state.finalFourPhase ? `Final Four - ${state.finalCornerPieces.filter(Boolean).length} pieces left - placement only`
        : state.pendingSwap ? `Swap choice - carry on, or swap sides with the player who placed the first piece`
        : state.consequence?.type === "jump-choice" ? `Jump consequence - the opponent chooses which piece to place`
        : state.redeployPiece ? `Jump consequence - ${participantName(state.currentPlayer)} places the jumped piece`
        : state.consequence?.type === "jump-responder-held" ? `Jump consequence - opponent places the handed piece, then the jumper places the jumped piece`
        : state.consequence?.type === "move" ? `Move consequence - opponent chooses and places a piece, then the mover places the held piece`
        : state.consequence?.type === "jump-held" ? `Jump consequence - place your held piece`
        : oneColourPlacementOnly() ? `One-colour finish - ${normalReserveTotal()} normal reserve pieces left - placement only`
        : isLipfty24() ? `Main play - empty 6×6 start; opponent hands a reserve piece: Place, Move or Jump with that colour.`
        : `Main play - four pinned opening anchors are in place; opponent hands a reserve piece: Place, Move or Jump with that colour.`;
    }
    const boardNote = document.getElementById("board-note");
    if (boardNote) {
      boardNote.textContent = isLipfty24()
        ? "Lipfty: the inner 6×6 starts empty; the 24 pieces start round the outside ring, leaving the four corners empty."
        : "Lipfty: inner 6×6 playing area with 4 pinned Opening Four pieces, 24 normal reserve pieces and 4 Final Four corner pieces.";
    }
    const quickRulesTitle = document.getElementById("quick-rules-title");
    if (quickRulesTitle) {
      const versionTitle = settings.allowSquare ? "Extreme" : (settings.allowMove || settings.allowJump) ? "Standard" : "Learning";
      quickRulesTitle.textContent = `${gameFormatTitle()} · ${versionTitle}`;
    }
    const quickOpening = document.getElementById("quick-opening-rule");
    if (quickOpening) {
      quickOpening.innerHTML = isLipfty24()
        ? "<strong>Start:</strong> the inner 6×6 starts empty. All 24 pieces (12 of each colour) start round the outside ring and are shared by both players."
        : "<strong>Opening:</strong> four diagonal-colour special pieces start pinned on the corners of the inner 6×6. They count towards wins but never move and cannot be jumped over.";
    }
    const placementAlert = document.getElementById("placement-alert");
    if (placementAlert) {
      placementAlert.hidden = state.compulsoryPlacementsRemaining === 0;
      placementAlert.textContent = state.compulsoryPlacementsRemaining ? `COMPULSORY PLACEMENT - ${state.compulsoryPlacementsRemaining} remaining` : "";
    }
    const reserveHeading = document.getElementById("reserve-heading");
    if (reserveHeading) reserveHeading.textContent = state.consequence?.type === "jump-choice" ? "Choose a piece" : state.redeployPiece ? "Jumped piece to place" : "Colour to use";
    const humanChoosingColour = state.winner === null && state.choosingColour && !computerBusy && !isComputer(state.colourChooser);
    const choices = humanChoosingColour ? availableChoiceColours() : [];
    blackButton.disabled = !choices.includes("black");
    whiteButton.disabled = !choices.includes("white");
    // While choosing a new piece after a Move, the original held piece is not
    // the new choice.  Do not paint its colour as though it were selected.
    const assigned = humanChoosingColour ? null : (state.redeployPiece?.colour || state.assignedColour);
    blackButton.classList.toggle("reserve-button--assigned", !!assigned && assigned === "black");
    whiteButton.classList.toggle("reserve-button--assigned", !!assigned && assigned === "white");
    blackButton.classList.toggle("reserve-button--not-assigned", !!assigned && assigned !== "black");
    whiteButton.classList.toggle("reserve-button--not-assigned", !!assigned && assigned !== "white");
    blackButton.classList.remove("reserve-button--returned"); whiteButton.classList.remove("reserve-button--returned");
    undoButton.hidden = !settings.undo; undoButton.disabled = computerBusy || checkpoints.length === 0;
    jumpControls.hidden = true;
    renderBoard();
  }

  function hasSafeFirstFinalFourPlacement(board, finalColours) {
    const emptyCells = [];
    for (let i = 0; i < BOARD_CELLS; i += 1) if (!board[i]) emptyCells.push(i);
    const firstColours = [...new Set(finalColours.filter(Boolean))];

    for (const firstColour of firstColours) {
      const remainingColours = [...finalColours];
      const usedIndex = remainingColours.indexOf(firstColour);
      if (usedIndex >= 0) remainingColours.splice(usedIndex, 1);
      const replyColours = [...new Set(remainingColours.filter(Boolean))];

      for (const firstTo of emptyCells) {
        const afterFirst = [...board];
        afterFirst[firstTo] = { id: -1, colour: firstColour, pinned: false, special: true };
        // A first placement that wins immediately is useful in normal play,
        // but it does not exercise the Final Four exchange we want to test.
        if (rules.checkWin(afterFirst, settings)) continue;

        let opponentHasImmediateWin = false;
        for (const replyColour of replyColours) {
          for (const replyTo of emptyCells) {
            if (replyTo === firstTo) continue;
            const afterReply = [...afterFirst];
            afterReply[replyTo] = { id: -2, colour: replyColour, pinned: false, special: true };
            if (rules.checkWin(afterReply, settings)) {
              opponentHasImmediateWin = true;
              break;
            }
          }
          if (opponentHasImmediateWin) break;
        }

        if (!opponentHasImmediateWin) return true;
      }
    }
    return false;
  }

  function jumpToFinalFourTest() {
    // Hidden near-end test shortcut. Full Lipfty jumps to the Final Four.
    // Lipfty24 instead leaves four ordinary reserve pieces (two of each
    // colour) so its genuine no-Final-Four ending can be played through.
    clearTimeout(flowTimer); computerBusy = false; computerMoveVisual = null; nextPieceId = 1; checkpoints = []; state = freshState();
    state.swapDone = true;

    if (isLipfty24()) {
      const keepIndices = new Set([
        ...shuffled(activeReserveIndices("black")).slice(0, 2),
        ...shuffled(activeReserveIndices("white")).slice(0, 2)
      ]);
      for (let i = 0; i < state.reserveLayout.active.length; i += 1) {
        if (!keepIndices.has(i)) state.reserveLayout.active[i] = null;
      }

      const availableCells = [...Array(BOARD_CELLS).keys()];
      let attempts = 0;
      do {
        state.board = Array(BOARD_CELLS).fill(null);
        const occupied = shuffled(availableCells).slice(0, 20);
        const colours = shuffled([...Array(10).fill("black"), ...Array(10).fill("white")]);
        occupied.forEach((index, i) => { state.board[index] = { id: nextPieceId++, colour: colours[i], pinned: false }; });
        attempts += 1;
      } while (rules.checkWin(state.board, settings) && attempts < 10000);

      state.currentPlayer = 0;
      state.colourChooser = otherPlayer(state.currentPlayer);
      state.choosingColour = true;
      initialiseChessClock();
      processFlow();
      return true;
    }

    const anchorBoard = state.board.map(piece => piece ? { ...piece } : null);
    const availableCells = [...Array(BOARD_CELLS).keys()].filter(i => !anchorBoard[i]);
    const finalColours = CORNERS.map(index => state.reserveLayout.locked[index]).filter(Boolean);
    let attempts = 0, safeOpening = false;
    state.reserveLayout.active.fill(null);

    // A random no-win board can still be a forced loss: every possible first
    // Final Four placement may leave an immediate winning reply. Keep looking
    // until the player has at least one first placement that does not itself
    // win and does not give the opponent an immediate winning placement.
    do {
      state.board = anchorBoard.map(piece => piece ? { ...piece } : null);
      const occupied = shuffled(availableCells).slice(0, 24);
      const colours = shuffled([...Array(12).fill("black"), ...Array(12).fill("white")]);
      let pieceId = 5;
      occupied.forEach((index, i) => { state.board[index] = { id: pieceId++, colour: colours[i], pinned: false }; });
      attempts += 1;
      safeOpening = !rules.checkWin(state.board, settings) && hasSafeFirstFinalFourPlacement(state.board, finalColours);
    } while (!safeOpening && attempts < 3000);

    if (!safeOpening) {
      // Deterministic fallback verified against the strongest (Extreme) win
      // patterns. It guarantees the Easter egg never starts as a forced
      // immediate loss even if random generation does not find one quickly.
      const fallback = [
        [1,"black"],[2,"white"],[3,"white"],[4,"black"],[8,"black"],[11,"white"],
        [12,"black"],[14,"white"],[15,"black"],[16,"black"],[17,"white"],[19,"black"],
        [20,"black"],[21,"white"],[22,"white"],[23,"black"],[24,"white"],[25,"white"],
        [26,"white"],[27,"black"],[29,"white"],[31,"black"],[33,"black"],[34,"white"]
      ];
      state.board = anchorBoard.map(piece => piece ? { ...piece } : null);
      let pieceId = 5;
      fallback.forEach(([index, colour]) => { state.board[index] = { id: pieceId++, colour, pinned: false }; });
    }

    nextPieceId = 29;
    state.currentPlayer = 0; state.colourChooser = 0; state.choosingColour = true;
    prepareFinalCorners(); state.finalFourPhase = true;
    initialiseChessClock();
    processFlow();
    return true;
  }

  function resolvedStarterIndex() {
    let starter = settings.starter;
    if (starter === "random") return Math.random() < 0.5 ? 0 : 1;
    if (starter === "alternate") {
      const previous = localStorage.getItem("lipfty-last-starter") || "other";
      const next = previous === "player" ? "other" : "player";
      localStorage.setItem("lipfty-last-starter", next);
      return next === "player" ? 0 : 1;
    }
    if (starter === "computer") return 1;
    return 0;
  }

  function startNewGame() {
    resultRecorded = false;
    clearTimeout(flowTimer); computerBusy = false; computerMoveVisual = null; nextPieceId = 1; checkpoints = []; state = freshState(); applyPieceColours();
    state.currentPlayer = resolvedStarterIndex();
    // With the automatic opening already complete, P2/opponent makes the first
    // normal handover to the selected starting player.
    state.colourChooser = otherPlayer(state.currentPlayer);
    state.choosingColour = true;
    initialiseChessClock();
    processFlow();
  }

  function clockEnabled() { return Number(settings.clockMinutes) > 0; }
  function clockIncrementMs() { return Math.max(0, Number(settings.clockIncrement) || 0) * 1000; }
  function decisionActorIndex() {
    if (!state || state.winner !== null) return null;
    if (state.pendingSwap) return state.pendingSwap.decider;
    return state.choosingColour ? state.colourChooser : state.currentPlayer;
  }
  function formatChessClock(milliseconds) {
    const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }
  function stopChessClockInterval() {
    if (clockInterval) clearInterval(clockInterval);
    clockInterval = null;
  }
  function settleChessClock(now = Date.now()) {
    if (!clockEnabled() || clockActivePlayer === null || clockLastTick === null || state?.winner !== null) return null;
    const elapsed = Math.max(0, now - clockLastTick);
    if (elapsed > 0) {
      clockRemainingMs[clockActivePlayer] = Math.max(0, clockRemainingMs[clockActivePlayer] - elapsed);
      clockLastTick = now;
    }
    return clockRemainingMs[clockActivePlayer] <= 0 ? clockActivePlayer : null;
  }
  function initialiseChessClock() {
    stopChessClockInterval();
    const initial = clockEnabled() ? Number(settings.clockMinutes) * 60 * 1000 : 0;
    clockRemainingMs = [initial, initial];
    clockActivePlayer = null;
    clockLastTick = null;
    renderChessClocks();
  }
  function restoreChessClock(snapshot) {
    stopChessClockInterval();
    if (!clockEnabled()) {
      clockRemainingMs = [0, 0];
      clockActivePlayer = null;
      clockLastTick = null;
      return;
    }
    const initial = Number(settings.clockMinutes) * 60 * 1000;
    clockRemainingMs = Array.isArray(snapshot?.remainingMs) ? [...snapshot.remainingMs] : [initial, initial];
    clockActivePlayer = Number.isInteger(snapshot?.activePlayer) ? snapshot.activePlayer : null;
    clockLastTick = clockActivePlayer === null ? null : Date.now();
  }
  function finishTimeLoss(expiredPlayer) {
    if (!state || state.winner !== null) return;
    clearTimeout(flowTimer);
    computerBusy = false;
    computerMoveVisual = null;
    stopChessClockInterval();
    clockRemainingMs[expiredPlayer] = 0;
    clockActivePlayer = null;
    clockLastTick = null;
    state.winner = otherPlayer(expiredPlayer);
    state.winReason = "time";
    clearSelection();
    setStatus(`${participantName(expiredPlayer)} ran out of time. ${participantName(state.winner)} wins on time.`);
    render();
    maybeShowUpdateDialog();
  }
  function startChessClockInterval() {
    if (clockInterval || !clockEnabled() || clockActivePlayer === null || state?.winner !== null) return;
    clockInterval = setInterval(() => {
      const expired = settleChessClock();
      if (expired !== null) { finishTimeLoss(expired); return; }
      renderChessClocks();
    }, 200);
  }
  function syncChessClock({ addIncrement = true } = {}) {
    if (!clockEnabled()) {
      stopChessClockInterval();
      clockActivePlayer = null;
      clockLastTick = null;
      renderChessClocks();
      return;
    }
    const now = Date.now();
    const expired = settleChessClock(now);
    if (expired !== null) { finishTimeLoss(expired); return; }
    if (!state || state.winner !== null) {
      stopChessClockInterval();
      clockActivePlayer = null;
      clockLastTick = null;
      renderChessClocks();
      return;
    }
    const nextPlayer = decisionActorIndex();
    if (nextPlayer !== clockActivePlayer) {
      if (addIncrement && clockActivePlayer !== null) {
        clockRemainingMs[clockActivePlayer] += clockIncrementMs();
      }
      clockActivePlayer = nextPlayer;
    }
    clockLastTick = clockActivePlayer === null ? null : now;
    startChessClockInterval();
    renderChessClocks();
  }
  function renderChessClocks() {
    const panel = document.getElementById("chess-clocks");
    const row = document.querySelector(".turn-status-row");
    if (!panel) return;
    const enabled = clockEnabled();
    panel.hidden = !enabled;
    row?.classList.toggle("chess-clock-enabled", enabled);
    if (!enabled) return;
    const names = [document.getElementById("clock-player-0-name"), document.getElementById("clock-player-1-name")];
    const values = [document.getElementById("clock-player-0"), document.getElementById("clock-player-1")];
    for (let player = 0; player < 2; player += 1) {
      if (names[player]) names[player].textContent = participantName(player);
      if (values[player]) values[player].textContent = formatChessClock(clockRemainingMs[player]);
      const card = panel.querySelector(`[data-clock-player="${player}"]`);
      card?.classList.toggle("chess-clock-card--active", state?.winner === null && clockActivePlayer === player);
      card?.classList.toggle("chess-clock-card--expired", clockRemainingMs[player] <= 0);
    }
  }

  blackButton.addEventListener("click", () => chooseReserveColourFromPanel("black"));
  whiteButton.addEventListener("click", () => chooseReserveColourFromPanel("white"));
  document.getElementById("new-game").addEventListener("click", useSavedSettingsForNewGame);

  // The old visible End button was only ever a development shortcut. Remove it
  // from the normal interface, but retain the useful Final Four test as a
  // deliberately hidden five-tap/click Easter egg on either version display.
  document.getElementById("end-test")?.remove();
  let versionTestTaps = [];
  function handleVersionTestTap() {
    const now = Date.now();
    versionTestTaps = versionTestTaps.filter(time => now - time <= 3000);
    versionTestTaps.push(now);
    if (versionTestTaps.length < 5) return;
    versionTestTaps = [];
    jumpToFinalFourTest();
  }
  [document.getElementById("app-version"), mobileVersionElement]
    .filter(Boolean)
    .forEach(element => element.addEventListener("click", handleVersionTestTap));

  undoButton.addEventListener("click", undo);
  finishJumpButton.addEventListener("click", () => {});

  const settingsDialog = document.getElementById("settings-dialog"), settingsForm = document.getElementById("settings-form");
  const wizardSteps = [...document.querySelectorAll("[data-wizard-step]")], wizardIndicators = [...document.querySelectorAll("[data-step-indicator]")];
  const wizardBack = document.getElementById("wizard-back"), wizardNext = document.getElementById("wizard-next"), wizardStart = document.getElementById("wizard-start");
  const wizardSave = document.getElementById("cancel-settings");
  const wizardActions = settingsForm.querySelector(".wizard-actions");
  const wizardDefault = document.createElement("button");
  wizardDefault.className = "button button--secondary";
  wizardDefault.id = "wizard-default";
  wizardDefault.type = "button";
  wizardDefault.textContent = "Default";
  wizardDefault.style.marginRight = "auto";
  wizardActions.prepend(wizardDefault);
  // Lipfty 12: Settings has one Save action. The old Save button is removed;
  // the existing submit button is now Save and starts a fresh game using the
  // settings shown in the wizard.
  wizardSave.remove();
  wizardStart.textContent = "Save";
  const difficultyInput = document.getElementById("difficulty-input"), difficultyField = document.getElementById("difficulty-field");
  const player1Input = document.getElementById("setting-player1"), player2Input = document.getElementById("setting-player2"), player2Label = document.getElementById("player2-label");
  let wizardStep = 0;
  const colourOptions = ["red", "blue", "green", "yellow", "purple", "orange", "black", "white"];
  function buildColours(id, name) {
    const box = document.getElementById(id);
    colourOptions.forEach(k => {
      const l = document.createElement("label"); l.className = "colour-choice";
      l.innerHTML = `<input type="radio" name="${name}" value="${k}"><span><i class="colour-swatch" style="background:${COLOURS[k][1]}"></i>${COLOURS[k][0]}</span>`;
      box.appendChild(l);
    });
  }
  buildColours("colour1-choices", "colour1"); buildColours("colour2-choices", "colour2");
  function fv(n) { return settingsForm.querySelector(`[name="${n}"]:checked`)?.value; }
  function sr(n, v) { const e = settingsForm.querySelector(`[name="${n}"][value="${v}"]`); if (e) e.checked = true; }
  function syncMode() {
    const one = fv("gameMode") === "computer"; difficultyField.hidden = !one; player2Label.hidden = one;
    document.getElementById("player1-label-text").textContent = one ? "Player name" : "Player 1 name";
    document.getElementById("starter-player-label").textContent = one ? "Player" : "Player 1";
    document.getElementById("starter-other-label").textContent = one ? "Computer" : "Player 2";
  }
  function syncDifficulty() { const n = Number(difficultyInput.value), names = ["", "Beginner", "Standard", "Expert"]; document.getElementById("difficulty-name").textContent = `${n} · ${names[n]}`; }
  const ruleOptionIds = ["allowJump", "allowMove", "allowDiagonal", "allowSquare", "allowSpacedSquare"];
  function ruleId(k) { return `setting-${k.replace(/[A-Z]/g, m => "-" + m.toLowerCase())}`; }
  function syncRuleDependencies() {
    const square = document.getElementById("setting-allow-square").checked;
    document.getElementById("setting-allow-spaced-square").disabled = !square;
  }
  document.querySelectorAll("[data-rule-option]").forEach(e => e.addEventListener("change", syncRuleDependencies));
  function showStep(n) {
    wizardStep = Math.max(0, Math.min(5, n));
    wizardSteps.forEach((e, i) => e.hidden = i !== wizardStep);
    wizardIndicators.forEach((e, i) => {
      e.classList.toggle("wizard-progress-step--active", i === wizardStep);
      e.classList.toggle("wizard-progress-step--complete", i < wizardStep);
      if (i === wizardStep) e.setAttribute("aria-current", "step");
      else e.removeAttribute("aria-current");
    });
    wizardDefault.hidden = wizardStep !== 0;
    wizardBack.hidden = wizardStep === 0; wizardNext.hidden = wizardStep === 5; wizardStart.hidden = false;
    if (wizardStep === 5) summary();
  }
  // The six page names at the top of Settings are direct navigation as well
  // as progress indicators. Keep keyboard access too because the HTML uses
  // spans rather than native buttons.
  wizardIndicators.forEach((indicator, index) => {
    const pageName = indicator.querySelector("small")?.textContent?.trim() || `page ${index + 1}`;
    indicator.setAttribute("role", "button");
    indicator.setAttribute("tabindex", "0");
    indicator.setAttribute("aria-label", `Go to Settings page ${index + 1}: ${pageName}`);
    indicator.style.cursor = "pointer";
    indicator.addEventListener("click", () => showStep(index));
    indicator.addEventListener("keydown", event => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      showStep(index);
    });
  });
  function resetSettingsFormToDefaults() {
    sr("gameFormat", "lipfty24");
    sr("gameMode", "computer");
    difficultyInput.value = 2;
    sr("allowUndo", "yes");
    sr("colour1", "red");
    sr("colour2", "blue");
    sr("gameVersion", "standard");
    player1Input.value = "Player";
    player2Input.value = "Player 2";
    sr("starter", "random");
    sr("clockMinutes", "0");
    sr("clockIncrement", "0");
    const defaultRules = { allowJump: true, allowMove: true, allowDiagonal: true, allowSquare: false, allowSpacedSquare: false };
    ruleOptionIds.forEach(k => { const e = document.getElementById(ruleId(k)); if (e) e.checked = defaultRules[k]; });
    document.getElementById("setting-sound").checked = true;
    document.getElementById("setting-animations").checked = true;
    document.getElementById("setting-language").value = "en-GB";
    syncRuleDependencies();
    syncMode();
    syncDifficulty();
    syncClockOptions();
  }
  function coloursValid() { return fv("colour1") !== fv("colour2"); }
  function selectedRuleSummary() { const labels = []; document.querySelectorAll("[data-rule-option]:checked").forEach(e => labels.push(e.dataset.ruleLabel)); return labels.length ? labels.join(", ") : "Basic placement only"; }
  function summary() {
    const one = fv("gameMode") === "computer", level = ["", "Beginner", "Standard", "Expert"][Number(difficultyInput.value)];
    const clockMinutes = Number(fv("clockMinutes") || 0), increment = Number(fv("clockIncrement") || 0);
    const clockSummary = clockMinutes ? `${clockMinutes} min each${increment ? ` + ${increment}s` : ""}` : "Clock off";
    const format = "Lipfty";
    document.getElementById("setup-summary").textContent = `${format} · ${one ? "Player vs Computer · " + level : "Two players"} · ${COLOURS[fv("colour1")][0]} / ${COLOURS[fv("colour2")][0]} · ${selectedRuleSummary()} · ${clockSummary}`;
  }
  function openSettings() {
    // Show the saved / next-game choices, not the immutable settings snapshot
    // belonging to the board that is already in progress.
    sr("gameFormat", "lipfty24");
    sr("gameMode", savedSettings.mode); difficultyInput.value = savedSettings.level === "beginner" ? 1 : savedSettings.level === "expert" ? 3 : 2;
    sr("allowUndo", savedSettings.undo ? "yes" : "no"); sr("colour1", savedSettings.colour1); sr("colour2", savedSettings.colour2);
    player1Input.value = savedSettings.player1; player2Input.value = savedSettings.player2; sr("starter", savedSettings.starter);
    sr("clockMinutes", String(savedSettings.clockMinutes || 0)); sr("clockIncrement", String(savedSettings.clockIncrement || 0));
    ruleOptionIds.forEach(k => { const e = document.getElementById(ruleId(k)); if (e) e.checked = !!savedSettings[k]; });
    syncRuleDependencies(); document.getElementById("setting-sound").checked = savedSettings.sound; document.getElementById("setting-animations").checked = savedSettings.animations;
    syncMode(); syncDifficulty(); syncClockOptions(); showStep(0); settingsDialog.showModal();
  }
  settingsForm.querySelectorAll('[name="gameFormat"]').forEach(e => e.addEventListener("change", () => { if (wizardStep === 5) summary(); }));
  settingsForm.querySelectorAll('[name="gameMode"]').forEach(e => e.addEventListener("change", syncMode));
  difficultyInput.addEventListener("input", syncDifficulty);
  function syncClockOptions() {
    const enabled = Number(fv("clockMinutes") || 0) > 0;
    const field = document.getElementById("clock-increment-field");
    if (field) field.disabled = !enabled;
    if (!enabled) sr("clockIncrement", "0");
    if (wizardStep === 5) summary();
  }
  settingsForm.querySelectorAll('[name="clockMinutes"]').forEach(e => e.addEventListener("change", syncClockOptions));
  settingsForm.querySelectorAll('[name="clockIncrement"]').forEach(e => e.addEventListener("change", () => { if (wizardStep === 5) summary(); }));
  wizardDefault.addEventListener("click", resetSettingsFormToDefaults);
  wizardNext.addEventListener("click", () => { if (wizardStep === 1 && !coloursValid()) { setStatus("Choose two different piece colours."); return; } showStep(wizardStep + 1); });
  wizardBack.addEventListener("click", () => showStep(wizardStep - 1));
  function commitSettingsFromForm() {
    if (!coloursValid()) {
      showStep(1);
      setStatus("Choose two different piece colours.");
      return false;
    }
    const n = Number(difficultyInput.value), ruleSettings = {};
    ruleOptionIds.forEach(k => { ruleSettings[k] = document.getElementById(ruleId(k)).checked; });
    if (!ruleSettings.allowSquare) ruleSettings.allowSpacedSquare = false;
    ruleSettings.allowDiamond = false;
    ruleSettings.allowSpacedDiamond = false;

    // The single Settings Save action stores the wizard values and immediately
    // starts a fresh game using them.
    savedSettings = { ...savedSettings, ...ruleSettings, gameFormat: "lipfty24", mode: fv("gameMode"), player1: player1Input.value.trim() || "Player", player2: player2Input.value.trim() || "Player 2", level: n === 1 ? "beginner" : n === 3 ? "expert" : "standard", starter: fv("starter"), undo: fv("allowUndo") === "yes", colour1: fv("colour1"), colour2: fv("colour2"), clockMinutes: Number(fv("clockMinutes") || 0), clockIncrement: Number(fv("clockIncrement") || 0), sound: document.getElementById("setting-sound").checked, animations: document.getElementById("setting-animations").checked, language: document.getElementById("setting-language").value };
    saveSettings();
    settingsDialog.close();
    useSavedSettingsForNewGame();
    return true;
  }

  document.getElementById("settings-button").addEventListener("click", openSettings);
  document.getElementById("close-settings").addEventListener("click", () => settingsDialog.close());
  settingsForm.addEventListener("submit", e => {
    e.preventDefault();
    commitSettingsFromForm();
  });


  // Lipfty 13: game results kept on this device (one result per game; Undo after a finished game does not count twice).
  const STATS_KEY = "lipfty-stats";
  let resultRecorded = false;
  function emptyStats() {
    return { computer: { played: 0, won: 0, lost: 0, drawn: 0 }, two: { played: 0, p1: 0, p2: 0, drawn: 0 } };
  }
  function loadStats() {
    try {
      const saved = JSON.parse(localStorage.getItem(STATS_KEY) || "null");
      const base = emptyStats();
      if (!saved) return base;
      return { computer: { ...base.computer, ...saved.computer }, two: { ...base.two, ...saved.two } };
    } catch (_) { return emptyStats(); }
  }
  function maybeRecordResult() {
    if (resultRecorded || state.winner === null) return;
    resultRecorded = true;
    const stats = loadStats();
    if (settings.mode === "computer") {
      const s = stats.computer; s.played += 1;
      if (state.winner === "draw") s.drawn += 1; else if (isComputer(state.winner)) s.lost += 1; else s.won += 1;
    } else {
      const s = stats.two; s.played += 1;
      if (state.winner === "draw") s.drawn += 1; else if (state.winner === 0) s.p1 += 1; else s.p2 += 1;
    }
    try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch (_) {}
  }
  function renderStatistics() {
    const stats = loadStats();
    const box = document.getElementById("statistics-content");
    const tile = (value, label) => `<span><strong>${value}</strong><small>${label}</small></span>`;
    const esc = text => String(text).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const c = stats.computer, t = stats.two;
    const name1 = settings.mode === "computer" ? "Player 1" : participantName(0);
    const name2 = settings.mode === "computer" ? "Player 2" : participantName(1);
    box.innerHTML =
      `<h3>Against the computer</h3><div class="statistics-summary">${tile(c.played, "Played")}${tile(c.won, "You won")}${tile(c.lost, "Computer won")}${tile(c.drawn, "Draws")}</div>` +
      `<h3>Two players</h3><div class="statistics-summary">${tile(t.played, "Played")}${tile(t.p1, esc(name1) + " won")}${tile(t.p2, esc(name2) + " won")}${tile(t.drawn, "Draws")}</div>` +
      (c.played + t.played === 0 ? `<p class="statistics-note">No finished games yet. Results are saved on this device when a game ends.</p>` : `<p class="statistics-note">Saved on this device only.</p>`);
  }
  // Swap rule dialog (human decider only).
  function openSwapDialog() {
    const dialog = document.getElementById("swap-dialog");
    if (!dialog || !state.pendingSwap) return;
    const { placer, decider, colour, index } = state.pendingSwap;
    const square = index !== null && index !== undefined ? `${"abcdef"[index % 6]}${6 - Math.floor(index / 6)}` : "";
    document.getElementById("swap-title").textContent = `${participantName(decider)}: carry on, or swap sides?`;
    document.getElementById("swap-text").textContent =
      `${participantName(placer)} placed the first piece${colour ? ` (${colourTitle(colour)}${square ? ` on ${square}` : ""})` : ""}.`;
    document.getElementById("swap-carry-note").textContent =
      `Carry on: ${participantName(placer)} hands you a piece and you take the next turn.`;
    document.getElementById("swap-sides-note").textContent =
      `Swap sides: you take over ${participantName(placer)}'s position. You hand ${participantName(placer)} a piece and they take the next turn. The first piece stays where it is.`;
    if (!dialog.open) dialog.showModal();
  }
  function closeSwapDialog() {
    const dialog = document.getElementById("swap-dialog");
    if (dialog?.open) dialog.close();
  }
  document.getElementById("swap-carry-on").addEventListener("click", () => resolveSwap(false));
  document.getElementById("swap-sides").addEventListener("click", () => resolveSwap(true));
  // The swap choice must be made: Escape does not dismiss it.
  document.getElementById("swap-dialog").addEventListener("cancel", event => event.preventDefault());

  const statisticsDialog = document.getElementById("statistics-dialog");
  document.getElementById("view-statistics-button").addEventListener("click", () => { renderStatistics(); statisticsDialog.showModal(); });
  document.getElementById("reset-statistics").addEventListener("click", () => {
    if (!confirm("Reset all Lipfty statistics on this device?")) return;
    try { localStorage.removeItem(STATS_KEY); } catch (_) {}
    renderStatistics();
  });
  document.getElementById("close-statistics").addEventListener("click", () => statisticsDialog.close());
  const helpDialog = document.getElementById("help-dialog");
  document.getElementById("help-button").addEventListener("click", () => helpDialog.showModal());
  document.getElementById("close-help").addEventListener("click", () => helpDialog.close());

  let pendingUpdateRegistration = null;
  function gameIsInProgress() {
    return !!state && state.winner === null && (
      state.redeployPiece || state.finalFourPhase || normalReserveTotal() < 24 ||
      state.board.some(piece => piece && !piece.pinned)
    );
  }
  function maybeShowUpdateDialog() {
    const registration = pendingUpdateRegistration, dialog = document.getElementById("pwa-update-dialog");
    if (!registration?.waiting || !dialog || dialog.open || gameIsInProgress()) return;
    const laterButton = document.getElementById("pwa-update-later"), updateButton = document.getElementById("pwa-update-button");
    const closeDialog = () => { if (dialog.open) dialog.close(); };
    laterButton.onclick = closeDialog;
    updateButton.onclick = () => { updateButton.disabled = true; updateButton.textContent = "Updating..."; registration.waiting?.postMessage({ type: "SKIP_WAITING" }); };
    dialog.oncancel = event => { event.preventDefault(); closeDialog(); };
    dialog.showModal();
  }
  function queueUpdate(registration) { if (!registration.waiting) return; pendingUpdateRegistration = registration; maybeShowUpdateDialog(); }
  async function registerPwa() {
    if (!("serviceWorker" in navigator)) return;
    try {
      const registration = await navigator.serviceWorker.register("service-worker.js", { scope: "./" });
      if (registration.waiting) queueUpdate(registration);
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        worker?.addEventListener("statechange", () => { if (worker.state === "installed" && navigator.serviceWorker.controller) queueUpdate(registration); });
      });
      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => { if (!refreshing) { refreshing = true; location.reload(); } });
    } catch (error) { console.warn("Lipfty service worker registration failed", error); }
  }

  fetch("./build-info.json", { cache: "no-store" })
    .then(response => response.ok ? response.json() : null)
    .then(info => {
      if (!info?.version) return;
      document.getElementById("app-version").textContent = `Version ${info.version}`;
      if (mobileVersionElement) mobileVersionElement.textContent = `v${info.version}`;
      const ref = info.commit || info.gitCommit || info.git || info.hash || info.commitHash || "";
      document.getElementById("build-reference").textContent = ref ? ` · ${String(ref).slice(0, 7)}` : "";
    }).catch(() => {});

  startNewGame();
  registerPwa();
})();
