(function () {
  "use strict";

  const R = window.LipftyRules;
  const CORNERS = [0, 7, 56, 63];
  const ANCHORS = [...R.ANCHOR_SQUARES];
  const EDGE_DEFS = [
    { name: "top", cells: [1,2,3,4,5,6], corners: [0,1] },
    { name: "right", cells: [15,23,31,39,47,55], corners: [1,3] },
    { name: "bottom", cells: [57,58,59,60,61,62], corners: [2,3] },
    { name: "left", cells: [8,16,24,32,40,48], corners: [0,2] }
  ];
  const COLOURS = {
    black: ["Black", "#1d1d1d"], white: ["White", "#f7f7f2"],
    red: ["Red", "#d6423a"], blue: ["Blue", "#2d65ad"], green: ["Green", "#318653"],
    yellow: ["Yellow", "#dba92f"], purple: ["Purple", "#7955a6"], orange: ["Orange", "#d97832"]
  };

  const el = id => document.getElementById(id);
  const boardEl = el("board");
  const statusEl = el("status");
  const currentEl = el("current-player");
  const reserveInfoEl = el("reserve-info");
  const blackBtn = el("choose-black");
  const whiteBtn = el("choose-white");
  const undoBtn = el("undo");
  const swapBox = el("swap-box");
  const jumpChoiceBox = el("jump-choice-box");

  let nextPieceId = 1;
  let state;
  let history = [];
  let timer = null;
  let clockInterval = null;
  let clockRemainingMs = [0, 0];
  let clockActivePlayer = null;
  let clockLastTick = null;
  let resultRecorded = false;

  function defaultSettings() {
    return {
      mode: "computer", level: "standard", version: "standard", starter: "random",
      player1: "Player", player2: "Player 2", colour1: "red", colour2: "blue",
      clockMinutes: 0, clockIncrement: 0, sound: true, animations: true, language: "en-GB",
      undo: true, colourDefaultsVersion: 1403
    };
  }
  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem("lipfty14-settings") || "{}");
      if (saved.colourDefaultsVersion !== 1403) {
        if ((saved.colour1 === undefined || saved.colour1 === "black") &&
            (saved.colour2 === undefined || saved.colour2 === "white")) {
          saved.colour1 = "red"; saved.colour2 = "blue";
        }
        saved.colourDefaultsVersion = 1403;
      }
      return { ...defaultSettings(), ...saved };
    } catch (_) { return defaultSettings(); }
  }
  function saveSettings() {
    try { localStorage.setItem("lipfty14-settings", JSON.stringify(settings)); } catch (_) {}
  }
  let settings = loadSettings();

  function colourCss(c) { return COLOURS[c === "black" ? settings.colour1 : settings.colour2][1]; }
  function colourName(c) { return COLOURS[c === "black" ? settings.colour1 : settings.colour2][0]; }

  function applyColours() {
    document.documentElement.style.setProperty("--piece-black", colourCss("black"));
    document.documentElement.style.setProperty("--piece-white", colourCss("white"));
    document.documentElement.classList.toggle("animations-off", settings.animations === false);
  }
  function isComputer(p) { return settings.mode === "computer" && p === 1; }
  function playerName(p) {
    if (isComputer(p)) return "Computer";
    if (settings.mode === "computer") return settings.player1 || "Player";
    return p === 0 ? (settings.player1 || "Player 1") : (settings.player2 || "Player 2");
  }
  function other(p) { return p === 0 ? 1 : 0; }

  function shuffled(a) {
    a = [...a];
    for (let i = a.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function freshReserve() {
    const active = Array(64).fill(null), locked = Array(64).fill(null);
    const normal = EDGE_DEFS.flatMap(e => e.cells);
    shuffled([...Array(12).fill("black"), ...Array(12).fill("white")]).forEach((c,i) => active[normal[i]] = c);
    shuffled(["black","black","white","white"]).forEach((c,i) => locked[CORNERS[i]] = c);
    return { active, locked };
  }

  function chooseStarter() {
    if (settings.starter === "player") return 0;
    if (settings.starter === "computer") return 1;
    if (settings.starter === "alternate") {
      const previous = localStorage.getItem("lipfty14-last-starter") || "computer";
      const next = previous === "player" ? "computer" : "player";
      localStorage.setItem("lipfty14-last-starter", next);
      return next === "player" ? 0 : 1;
    }
    return Math.random() < 0.5 ? 0 : 1;
  }

  function freshState() {
    const starter = chooseStarter();
    return {
      phase: "opening",
      board: Array(36).fill(null),
      reserve: freshReserve(),
      releasedCorners: [false,false,false,false],
      clearedEdges: [false,false,false,false],
      openingRemaining: { black: 2, white: 2 },
      openingPlaced: 0,
      currentPlayer: starter,
      colourChooser: other(starter),
      choosingColour: true,
      assignedColour: null,
      selectedReserveIndex: null,
      selectedBoardIndex: null,
      legalMoves: new Set(),
      legalJumps: new Map(),
      protectedPieceId: null,
      consequence: null,
      redeployPiece: null,
      pendingSwap: null,
      swapDone: false,
      winner: null,
      winningCells: [],
      winType: null,
      lastReleaseMessage: ""
    };
  }

  function cloneState(s) {
    return {
      ...s,
      board: s.board.map(p => p ? {...p} : null),
      reserve: { active: [...s.reserve.active], locked: [...s.reserve.locked] },
      releasedCorners: [...s.releasedCorners], clearedEdges: [...s.clearedEdges],
      openingRemaining: {...s.openingRemaining},
      legalMoves: new Set(s.legalMoves), legalJumps: new Map(s.legalJumps),
      consequence: s.consequence ? {...s.consequence, jumpedPiece: s.consequence.jumpedPiece ? {...s.consequence.jumpedPiece} : null} : null,
      redeployPiece: s.redeployPiece ? {...s.redeployPiece} : null,
      pendingSwap: s.pendingSwap ? {...s.pendingSwap} : null,
      winningCells: [...s.winningCells]
    };
  }
  function checkpoint() {
    if (!settings.undo || state.winner !== null) return;
    settleClock();
    history.push({ state: cloneState(state), clock: { remainingMs: [...clockRemainingMs], activePlayer: clockActivePlayer } });
    if (history.length > 60) history.shift();
  }
  function undo() {
    if (!settings.undo || !history.length || isComputer(state.currentPlayer)) return;
    clearTimeout(timer);
    const snap = history.pop();
    state = snap.state;
    restoreClock(snap.clock);
    render(); processFlow();
  }

  function activeReserveIndices(colour = null, exclude = null) {
    const out = [];
    for (let i = 0; i < 64; i += 1) {
      if (i === exclude) continue;
      const c = state.reserve.active[i];
      if (c && (!colour || c === colour)) out.push(i);
    }
    return out;
  }
  function reserveCount(colour) { return activeReserveIndices(colour).length; }
  function reserveTotal() { return activeReserveIndices().length; }
  function reserveColourCount() { return ["black","white"].filter(c => reserveCount(c) > 0).length; }
  function placementOnlyNow() { return state.phase === "main" && !state.consequence && !state.redeployPiece && reserveColourCount() <= 1; }

  function blockedAnchors() {
    return ANCHORS.filter((_, slot) => !state.releasedCorners[slot]);
  }
  function ruleOptions() {
    return {
      allowDiagonal: true,
      allowSquare: settings.version === "extreme",
      allowSpacedSquare: settings.version === "extreme",
      inactiveWinCells: blockedAnchors()
    };
  }

  function finishWin() {
    const w = R.checkWin(state.board, ruleOptions());
    if (!w) return false;
    state.winner = state.currentPlayer;
    state.winningCells = [...w.line];
    state.winType = w.type;
    state.choosingColour = false;
    state.selectedBoardIndex = null;
    stopClock(); maybeRecordResult(); playTone("win");
    render();
    maybeOfferUpdate();
    return true;
  }

  function releaseCorner(slot) {
    if (state.releasedCorners[slot]) return false;
    state.releasedCorners[slot] = true;
    const outer = CORNERS[slot];
    const colour = state.reserve.locked[outer];
    if (colour) {
      state.reserve.active[outer] = colour;
      state.reserve.locked[outer] = null;
    }
    return true;
  }
  function updateEdgeReleases() {
    const released = [];
    EDGE_DEFS.forEach((edge, edgeIndex) => {
      if (state.clearedEdges[edgeIndex]) return;
      if (!edge.cells.every(i => !state.reserve.active[i])) return;
      state.clearedEdges[edgeIndex] = true;
      const newly = edge.corners.filter(releaseCorner);
      if (newly.length) released.push(`${edge.name} edge released ${newly.length === 2 ? "both corners" : "a corner"}`);
    });
    state.lastReleaseMessage = released.join("; ");
  }

  function consumeReserve(index) {
    const colour = state.reserve.active[index];
    if (!colour) return null;
    const piece = { id: nextPieceId++, colour, pinned: false, special: CORNERS.includes(index), anchor: false };
    state.reserve.active[index] = null;
    updateEdgeReleases();
    return piece;
  }

  function availableChoiceColours() {
    if (state.phase === "opening") return ["black","white"].filter(c => state.openingRemaining[c] > 0);
    if (state.consequence?.type === "jump-choice") return [state.consequence.heldColour, state.consequence.jumpedPiece.colour];
    const exclude = state.consequence?.type === "move" ? state.consequence.heldIndex : null;
    return ["black","white"].filter(c => activeReserveIndices(c, exclude).length > 0);
  }

  function chooseColour(colour, exactIndex = null) {
    if (!state.choosingColour || state.winner !== null) return;
    if (!availableChoiceColours().includes(colour)) return;
    checkpoint();

    if (state.phase === "opening") {
      state.assignedColour = colour;
      state.choosingColour = false;
      render(); processFlow(); return;
    }
    if (state.consequence?.type === "jump-choice") {
      applyJumpChoice(colour); return;
    }

    const exclude = state.consequence?.type === "move" ? state.consequence.heldIndex : null;
    let candidates = activeReserveIndices(colour, exclude);
    if (exactIndex !== null) candidates = candidates.includes(exactIndex) ? [exactIndex] : [];
    if (!candidates.length) return;
    state.selectedReserveIndex = candidates[Math.floor(Math.random() * candidates.length)];
    state.assignedColour = colour;
    state.choosingColour = false;
    render(); processFlow();
  }

  function clearSelection() {
    state.selectedBoardIndex = null;
    state.legalMoves = new Set();
    state.legalJumps = new Map();
  }

  function nextNormalTurn(current, chooser, protectedId = null) {
    state.phase = "main";
    state.currentPlayer = current;
    state.colourChooser = chooser;
    state.protectedPieceId = protectedId;
    state.choosingColour = true;
    state.assignedColour = null;
    state.selectedReserveIndex = null;
    state.consequence = null;
    state.redeployPiece = null;
    clearSelection();
    if (reserveTotal() === 0) finishDraw();
    render(); processFlow();
  }

  function finishDraw() {
    if (state.winner !== null) return;
    state.winner = "draw";
    state.choosingColour = false;
    stopClock(); maybeRecordResult();
    render();
    maybeOfferUpdate();
  }

  function afterOpeningPlacement(placer) {
    // Opening Four is setup only: complete all four corner placements before
    // the Lipfty take/accept decision becomes available.
    const next = other(placer);
    state.currentPlayer = next;
    state.colourChooser = placer;
    state.choosingColour = true;
    state.assignedColour = null;
    if (state.openingPlaced >= 4) {
      state.phase = "main";
      render(); processFlow();
      return;
    }

    // After three Opening Four placements there is exactly one
    // colour and one corner left. There is no decision to make, so complete
    // that final setup placement immediately for either a human or computer.
    const remainingAnchors = ANCHORS.filter(i => !state.board[i]);
    const remainingColours = ["black","white"].filter(c => state.openingRemaining[c] > 0);
    if (remainingAnchors.length === 1 && remainingColours.length === 1) {
      state.assignedColour = remainingColours[0];
      state.choosingColour = false;
      placeOpening(remainingAnchors[0]);
      return;
    }

    render(); processFlow();
  }

  function placeOpening(index) {
    if (state.phase !== "opening" || state.choosingColour || !ANCHORS.includes(index) || state.board[index]) return;
    checkpoint();
    const colour = state.assignedColour;
    if (!colour || state.openingRemaining[colour] <= 0) return;
    state.board[index] = { id: nextPieceId++, colour, pinned: true, special: true, anchor: true };
    playTone("place");
    state.openingRemaining[colour] -= 1;
    state.openingPlaced += 1;
    state.assignedColour = null;
    afterOpeningPlacement(state.currentPlayer);
  }

  function resolveSwap(swap) {
    if (!state.pendingSwap) return;
    checkpoint();
    const { placer, decider } = state.pendingSwap;
    state.pendingSwap = null;
    state.currentPlayer = swap ? placer : decider;
    state.colourChooser = swap ? decider : placer;
    state.choosingColour = true;
    state.assignedColour = null;
    render(); processFlow();
  }

  function placePiece(index) {
    if (state.winner !== null || state.choosingColour || state.board[index]) return;
    checkpoint();

    if (state.redeployPiece) {
      state.board[index] = state.redeployPiece;
      playTone("place");
      state.redeployPiece = null;
      if (finishWin()) return;
      const c = state.consequence;
      if (c?.type === "jump-redeploy-first") {
        state.currentPlayer = c.jumper;
        state.assignedColour = c.heldColour;
        state.selectedReserveIndex = c.heldIndex;
        state.consequence = { ...c, type: "jump-held-second" };
        render(); processFlow(); return;
      }
      if (c?.type === "jump-jumped-second") {
        nextNormalTurn(c.responder, c.jumper, c.protectedPieceId); return;
      }
      return;
    }

    if (state.selectedReserveIndex === null || !state.assignedColour) return;
    const sourceIndex = state.selectedReserveIndex;
    const piece = consumeReserve(sourceIndex);
    if (!piece) return;
    state.board[index] = piece;
    playTone("place");
    state.selectedReserveIndex = null;
    state.assignedColour = null;
    clearSelection();
    if (finishWin()) return;

    // Lipfty 14 pie rule: the Opening Four are setup. Only the first ordinary
    // placement on the remaining 32 squares can be accepted or taken by the
    // other player. Accept means the other player continues normally; Take
    // means they take this position and make the original placer continue.
    if (!state.swapDone && state.phase === "main" && !state.consequence) {
      const placer = state.currentPlayer;
      state.swapDone = true;
      state.pendingSwap = { placer, decider: other(placer), firstNormalIndex: index, colour: piece.colour };
      state.choosingColour = false;
      render(); processFlow(); return;
    }

    const c = state.consequence;
    if (c?.type === "move" && c.step === 1) {
      state.currentPlayer = c.mover;
      state.selectedReserveIndex = c.heldIndex;
      state.assignedColour = c.heldColour;
      state.choosingColour = false;
      state.consequence = { ...c, step: 2 };
      render(); processFlow(); return;
    }
    if (c?.type === "move" && c.step === 2) {
      nextNormalTurn(c.responder, c.mover, c.protectedPieceId); return;
    }
    if (c?.type === "jump-held-first") {
      state.currentPlayer = c.jumper;
      state.redeployPiece = c.jumpedPiece;
      state.consequence = { ...c, type: "jump-jumped-second" };
      render(); processFlow(); return;
    }
    if (c?.type === "jump-held-second") {
      nextNormalTurn(c.responder, c.jumper, c.protectedPieceId); return;
    }

    nextNormalTurn(other(state.currentPlayer), state.currentPlayer, null);
  }

  function canMoveOrJump() {
    return settings.version !== "learning" && !state.consequence && !state.redeployPiece && !placementOnlyNow();
  }

  function selectBoardPiece(index) {
    if (!canMoveOrJump() || state.choosingColour || state.winner !== null) return;
    const p = state.board[index];
    if (!p || p.colour !== state.assignedColour || p.pinned || p.id === state.protectedPieceId) return;
    state.selectedBoardIndex = index;
    state.legalMoves = new Set(R.adjacentDestinations(state.board,index));
    state.legalJumps = new Map(R.jumpDestinations(state.board,index)
      .filter(j => state.board[j.over] && !state.board[j.over].pinned && state.board[j.over].colour !== p.colour)
      .map(j => [j.to,j]));
    render();
  }

  function moveOrJump(to) {
    const from = state.selectedBoardIndex;
    if (from === null) return;
    const jump = state.legalJumps.get(to) || null;
    const isJump = !!jump;
    if (!state.legalMoves.has(to) && !isJump) return;
    checkpoint();
    const piece = state.board[from];
    state.board[from] = null;
    state.board[to] = piece;
    playTone(isJump ? "jump" : "move");
    clearSelection();
    if (finishWin()) return;

    const heldIndex = state.selectedReserveIndex, heldColour = state.assignedColour;
    const mover = state.currentPlayer, responder = other(mover);
    if (!isJump) {
      state.consequence = { type:"move", step:1, mover, responder, heldIndex, heldColour, protectedPieceId: piece.id };
      state.currentPlayer = responder;
      state.colourChooser = responder;
      state.protectedPieceId = piece.id;
      state.selectedReserveIndex = null; state.assignedColour = null; state.choosingColour = true;
      render(); processFlow(); return;
    }

    const jumped = jump ? state.board[jump.over] : null;
    if (!jumped) return;
    state.board[jump.over] = null;
    state.consequence = { type:"jump-choice", jumper:mover, responder, heldIndex, heldColour, jumpedPiece:jumped, protectedPieceId:piece.id };
    state.currentPlayer = responder;
    state.colourChooser = responder;
    state.protectedPieceId = piece.id;
    state.selectedReserveIndex = null; state.assignedColour = null; state.choosingColour = true;
    render(); processFlow();
  }

  function applyJumpChoice(colour) {
    const c = state.consequence;
    if (!c || c.type !== "jump-choice") return;
    state.choosingColour = false;
    state.currentPlayer = c.responder;
    if (colour === c.jumpedPiece.colour) {
      state.redeployPiece = c.jumpedPiece;
      state.consequence = { ...c, type:"jump-redeploy-first" };
    } else {
      state.selectedReserveIndex = c.heldIndex;
      state.assignedColour = c.heldColour;
      state.consequence = { ...c, type:"jump-held-first" };
    }
    render(); processFlow();
  }

  function handleInner(index) {
    if (state.pendingSwap || state.winner !== null || isComputer(state.currentPlayer)) return;
    if (state.phase === "opening") { placeOpening(index); return; }
    if (state.choosingColour) return;
    if (state.selectedBoardIndex !== null && (state.legalMoves.has(index) || state.legalJumps.has(index))) { moveOrJump(index); return; }
    if (state.board[index]) { selectBoardPiece(index); return; }
    placePiece(index);
  }

  function chooseExactReserve(displayIndex) {
    if (state.phase !== "main" || !state.choosingColour || state.winner !== null || isComputer(state.colourChooser)) return;
    const colour = state.reserve.active[displayIndex];
    if (!colour) return;
    chooseColour(colour, displayIndex);
  }

  function winOptions(inactiveWinCells = blockedAnchors()) {
    return { ...ruleOptions(), inactiveWinCells };
  }

  function blockedAnchorsAfterReserveRemoval(index) {
    if (index === null || index === undefined) return blockedAnchors();
    const released = [...state.releasedCorners];
    EDGE_DEFS.forEach((edge, edgeIndex) => {
      if (state.clearedEdges[edgeIndex]) return;
      if (edge.cells.every(i => i === index || !state.reserve.active[i])) {
        edge.corners.forEach(slot => { released[slot] = true; });
      }
    });
    return ANCHORS.filter((_, slot) => !released[slot]);
  }

  function patternsFor(options) {
    const blocked = new Set(options.inactiveWinCells || []);
    const patterns = [...R.ORTHOGONAL_LINES, ...R.DIAGONAL_LINES];
    if (options.allowSquare) patterns.push(...(options.allowSpacedSquare ? R.AXIS_SQUARES : R.TIGHT_SQUARES));
    return patterns.filter(pattern => !pattern.some(i => blocked.has(i)));
  }

  function patternProgress(board, colour, inactiveWinCells = blockedAnchors()) {
    const weights = [0, 1, 5, 24, 5000];
    let score = 0;
    for (const pattern of patternsFor(winOptions(inactiveWinCells))) {
      let own = 0, blocked = false;
      for (const index of pattern) {
        const piece = board[index];
        if (!piece) continue;
        if (piece.colour !== colour) { blocked = true; break; }
        own += 1;
      }
      if (!blocked) score += weights[own];
    }
    return score;
  }

  function countImmediatePlacementWins(board, colour, inactiveWinCells = blockedAnchors()) {
    const options = winOptions(inactiveWinCells);
    let wins = 0;
    for (let to = 0; to < 36; to += 1) {
      if (board[to]) continue;
      const copy = [...board];
      copy[to] = { colour };
      if (R.checkWin(copy, options)) wins += 1;
    }
    return wins;
  }

  function centreScore(index) {
    const r = Math.floor(index / 6), c = index % 6;
    return 6 - (Math.abs(r - 2.5) + Math.abs(c - 2.5));
  }

  function boardAfterAction(action, removeJumped = false) {
    const board = state.board.map(piece => piece ? { ...piece } : null);
    if (action.type === "place") {
      board[action.to] = { colour: state.assignedColour };
    } else {
      const piece = board[action.from];
      board[action.from] = null;
      board[action.to] = piece;
      if (removeJumped && action.type === "jump") board[action.over] = null;
    }
    return board;
  }

  function actionInactiveWinCells(action) {
    return action.type === "place"
      ? blockedAnchorsAfterReserveRemoval(state.selectedReserveIndex)
      : blockedAnchors();
  }

  function actionWouldWin(action) {
    // The live game checks a Move/Jump win immediately after the moving piece
    // lands, before a jumped piece is removed. Mirror that exact timing here.
    return !!R.checkWin(boardAfterAction(action, false), winOptions(actionInactiveWinCells(action)));
  }

  function enumerateComputerActions() {
    const actions = [];
    if (state.selectedReserveIndex !== null) {
      for (let to = 0; to < 36; to += 1) if (!state.board[to]) actions.push({ type:"place", to });
    }
    if (!canMoveOrJump()) return actions;
    for (let from = 0; from < 36; from += 1) {
      const piece = state.board[from];
      if (!piece || piece.colour !== state.assignedColour || piece.pinned || piece.id === state.protectedPieceId) continue;
      R.adjacentDestinations(state.board, from).forEach(to => actions.push({ type:"move", from, to }));
      R.jumpDestinations(state.board, from)
        .filter(j => state.board[j.over] && !state.board[j.over].pinned && state.board[j.over].colour !== piece.colour)
        .forEach(j => actions.push({ type:"jump", from, to:j.to, over:j.over }));
    }
    return actions;
  }

  function positionalActionScore(action, expert = false) {
    const board = boardAfterAction(action, true);
    const inactive = actionInactiveWinCells(action);
    let score = patternProgress(board, state.assignedColour, inactive) * 6 + centreScore(action.to);
    if (action.type === "jump") score += 2;
    else if (action.type === "move") score += 1;

    if (expert) {
      const risks = ["black","white"].map(colour => countImmediatePlacementWins(board, colour, inactive));
      // After an ordinary placement the computer will choose the opponent's
      // next colour, so it can select the safer colour. After Move/Jump the
      // responder chooses for themselves, so assume they take the more dangerous one.
      const receiverRisk = action.type === "place" ? Math.min(...risks) : Math.max(...risks);
      score -= receiverRisk * 900;
    }
    return score;
  }

  function chooseBestByScore(items, scoreOf, highest = true) {
    if (!items.length) return null;
    let bestScore = highest ? -Infinity : Infinity;
    let best = [];
    for (const item of items) {
      const score = scoreOf(item);
      const better = highest ? score > bestScore : score < bestScore;
      if (better) { bestScore = score; best = [item]; }
      else if (score === bestScore) best.push(item);
    }
    return best[Math.floor(Math.random() * best.length)];
  }

  function computerChooseColour() {
    if (!isComputer(state.colourChooser) || !state.choosingColour) return;

    if (state.phase === "opening") {
      const colours = availableChoiceColours();
      if (!colours.length) { finishDraw(); return; }
      chooseColour(colours[Math.floor(Math.random() * colours.length)]);
      return;
    }

    if (state.consequence?.type === "jump-choice") {
      const c = state.consequence;
      const choices = [c.heldColour, c.jumpedPiece.colour];
      if (settings.level === "beginner") {
        applyJumpChoice(choices[Math.floor(Math.random() * choices.length)]);
        return;
      }
      const chosen = chooseBestByScore(choices, colour =>
        countImmediatePlacementWins(state.board, colour) * 1000 +
        (settings.level === "expert" ? patternProgress(state.board, colour) : 0), true);
      applyJumpChoice(chosen);
      return;
    }

    const colours = availableChoiceColours();
    if (!colours.length) { finishDraw(); return; }
    if (settings.level === "beginner") {
      chooseColour(colours[Math.floor(Math.random() * colours.length)]);
      return;
    }

    // During the first Move consequence the chooser is also the player who
    // places the selected reserve piece, so maximise their opportunity. On a
    // normal handover the computer is choosing for its opponent, so minimise it.
    const selfPlacement = state.consequence?.type === "move" && state.consequence.step === 1 && state.currentPlayer === state.colourChooser;
    const exclude = state.consequence?.type === "move" ? state.consequence.heldIndex : null;

    if (settings.level === "standard") {
      const chosenColour = chooseBestByScore(colours, colour => {
        const wins = countImmediatePlacementWins(state.board, colour);
        return wins * 1000 + patternProgress(state.board, colour);
      }, selfPlacement);
      chooseColour(chosenColour);
      return;
    }

    // Expert also chooses the exact physical reserve piece. That matters in
    // Lipfty 14 because lifting the final piece from an edge can release both
    // corners before the selected piece is placed.
    const candidates = [];
    for (const colour of colours) {
      for (const index of activeReserveIndices(colour, exclude)) candidates.push({ colour, index });
    }
    const chosen = chooseBestByScore(candidates, option => {
      const inactive = blockedAnchorsAfterReserveRemoval(option.index);
      const wins = countImmediatePlacementWins(state.board, option.colour, inactive);
      const progress = patternProgress(state.board, option.colour, inactive);
      return wins * 1000 + progress;
    }, selfPlacement);
    if (chosen) chooseColour(chosen.colour, chosen.index);
  }

  function computerPlay() {
    if (!isComputer(state.currentPlayer) || state.choosingColour || state.winner !== null) return;
    if (state.phase === "opening") {
      const choices = ANCHORS.filter(i => !state.board[i]);
      placeOpening(choices[Math.floor(Math.random()*choices.length)]);
      return;
    }

    if (state.redeployPiece) {
      const empties = state.board.map((piece,index) => piece ? null : index).filter(index => index !== null);
      if (!empties.length) { finishDraw(); return; }
      if (settings.level === "beginner") {
        placePiece(empties[Math.floor(Math.random()*empties.length)]);
        return;
      }
      const colour = state.redeployPiece.colour;
      const winning = empties.filter(to => {
        const board = [...state.board]; board[to] = { colour };
        return !!R.checkWin(board, ruleOptions());
      });
      const pool = winning.length ? winning : empties;
      const chosen = winning.length ? pool[Math.floor(Math.random()*pool.length)] :
        chooseBestByScore(pool, to => {
          const board = [...state.board]; board[to] = { colour };
          return patternProgress(board, colour) * 6 + centreScore(to);
        }, true);
      placePiece(chosen);
      return;
    }

    const actions = enumerateComputerActions();
    if (!actions.length) { finishDraw(); return; }
    if (settings.level === "beginner") {
      const action = actions[Math.floor(Math.random()*actions.length)];
      if (action.type === "place") placePiece(action.to);
      else { selectBoardPiece(action.from); moveOrJump(action.to); }
      return;
    }

    const wins = actions.filter(actionWouldWin);
    const candidates = wins.length ? wins : actions;
    const action = wins.length
      ? candidates[Math.floor(Math.random()*candidates.length)]
      : chooseBestByScore(candidates, candidate => positionalActionScore(candidate, settings.level === "expert"), true);
    if (action.type === "place") placePiece(action.to);
    else { selectBoardPiece(action.from); moveOrJump(action.to); }
  }

  function firstSquareStrength(index) {
    if (!Number.isInteger(index)) return 0;
    return patternsFor(ruleOptions()).filter(pattern => pattern.includes(index)).length;
  }

  function computerSwapDecision() {
    if (!state.pendingSwap) return false;
    if (settings.level === "beginner") return Math.random() < 0.5;
    const strength = firstSquareStrength(state.pendingSwap.firstNormalIndex);
    if (settings.level === "expert") return strength >= 7;
    return strength >= 8;
  }

  function processFlow() {
    clearTimeout(timer);
    syncClock();
    if (state.winner !== null) return;
    const shortDelay = settings.animations ? 180 : 0;
    const playDelay = settings.animations ? 420 : 0;
    if (state.pendingSwap) {
      if (isComputer(state.pendingSwap.decider)) timer = setTimeout(()=>resolveSwap(computerSwapDecision()), shortDelay);
      return;
    }
    if (state.choosingColour && isComputer(state.colourChooser)) { timer = setTimeout(computerChooseColour, shortDelay); return; }
    if (!state.choosingColour && isComputer(state.currentPlayer)) { timer = setTimeout(computerPlay, playDelay); }
  }

  function statusText() {
    if (state.winner === "draw") return "Draw — every reserve piece has been used without a win.";
    if (state.winner !== null) {
      if (state.winType === "time") return `${playerName(state.winner)} wins on time.`;
      return `${playerName(state.winner)} wins${state.winType === "square" ? " with a square" : " with four in a row"}.`;
    }
    if (state.pendingSwap) return `${playerName(state.pendingSwap.decider)}: accept the first placement or take the position?`;
    if (state.phase === "opening") {
      if (state.choosingColour) return `${playerName(state.colourChooser)}: choose the colour ${playerName(state.currentPlayer)} must place as an Opening Four piece.`;
      return `${playerName(state.currentPlayer)}: place the ${colourName(state.assignedColour)} Opening Four piece on any empty 6×6 corner.`;
    }
    if (state.consequence?.type === "jump-choice" && state.choosingColour) return `${playerName(state.currentPlayer)}: choose which piece you will place after the Jump.`;
    if (state.choosingColour) return `${playerName(state.colourChooser)}: choose a reserve piece/colour for ${playerName(state.currentPlayer)}.`;
    if (state.redeployPiece) return `${playerName(state.currentPlayer)}: place the jumped ${colourName(state.redeployPiece.colour)} piece on any empty square.`;
    if (state.consequence?.type === "move" && state.consequence.step === 2) return `${playerName(state.currentPlayer)}: now place the originally handed ${colourName(state.assignedColour)} piece on any empty square.`;
    if (!canMoveOrJump()) return `${playerName(state.currentPlayer)}: place the ${colourName(state.assignedColour)} piece on any empty square.`;
    return `${playerName(state.currentPlayer)}: Place, Move or Jump using ${colourName(state.assignedColour)}.`;
  }

  function renderPiece(colour, special=false, locked=false) {
    const s = document.createElement("span");
    s.className = `piece piece--${colour}${special ? " piece--special" : ""}${locked ? " piece--locked" : ""}`;
    return s;
  }

  function renderBoard() {
    boardEl.replaceChildren();
    const winning = new Set(state.winningCells);
    for (let d=0; d<64; d++) {
      const dr=Math.floor(d/8), dc=d%8, inner=dr>=1&&dr<=6&&dc>=1&&dc<=6;
      const btn=document.createElement("button"); btn.type="button"; btn.className="cell";
      btn.classList.add((dr+dc)%2 ? "dark" : "light");
      if (!inner) {
        btn.classList.add("reserve-cell");
        const slot=CORNERS.indexOf(d), active=state.reserve.active[d], locked=state.reserve.locked[d];
        if (active) {
          btn.appendChild(renderPiece(active, slot>=0));
          if (state.choosingColour && state.phase==="main" && !isComputer(state.colourChooser) && availableChoiceColours().includes(active)) {
            const held=state.consequence?.type==="move"?state.consequence.heldIndex:null;
            if (d!==held) { btn.classList.add("selectable"); btn.addEventListener("click",()=>chooseExactReserve(d)); }
          }
        } else if (locked) {
          btn.appendChild(renderPiece(locked,true,true));
          btn.title="Locked corner — clear either adjoining edge to release it";
        } else btn.classList.add("empty-reserve");
        if (slot>=0 && state.releasedCorners[slot]) btn.classList.add("released-corner");
      } else {
        const r=dr-1,c=dc-1,index=r*6+c; btn.classList.add("play-cell");
        if (winning.has(index)) btn.classList.add("winner");
        if (state.phase==="opening" && ANCHORS.includes(index) && !state.board[index] && !state.choosingColour) btn.classList.add("place-target");
        if (state.selectedBoardIndex===index) btn.classList.add("selected");
        if (state.legalMoves.has(index)) btn.classList.add("move-target");
        if (state.legalJumps.has(index)) btn.classList.add("jump-target");
        if (state.phase==="main" && !state.choosingColour && !state.board[index] && (state.selectedReserveIndex!==null || state.redeployPiece)) btn.classList.add("place-target");
        const p=state.board[index]; if (p) btn.appendChild(renderPiece(p.colour,p.special));
        btn.addEventListener("click",()=>handleInner(index));
      }
      boardEl.appendChild(btn);
    }
  }

  function render() {
    applyColours();
    currentEl.textContent = state.winner===null ? playerName(decisionActor()) : "Game over";
    statusEl.textContent = statusText() + (state.lastReleaseMessage ? ` ${state.lastReleaseMessage}.` : "");
    state.lastReleaseMessage = "";

    const versionTitle = settings.version === "learning" ? "Learning" : settings.version === "extreme" ? "Extreme" : "Standard";
    el("quick-rules-title").textContent = `Lipfty · ${versionTitle}`;
    el("quick-win-rule").innerHTML = settings.version === "extreme"
      ? "<strong>Win:</strong> four in a line, or a tight/spaced Square."
      : "<strong>Win:</strong> make four in a horizontal, vertical or diagonal line.";
    el("phase-help").textContent = state.phase === "opening"
      ? `Opening Four · ${state.openingPlaced}/4 placed. The opponent chooses the colour; the player chooses the corner.`
      : `${reserveTotal()} reserve pieces remain · ${state.releasedCorners.filter(Boolean).length}/4 outer corners released.`;

    blackBtn.querySelector("strong").textContent=colourName("black");
    whiteBtn.querySelector("strong").textContent=colourName("white");
    const blackCount = state.phase==="opening" ? state.openingRemaining.black : reserveCount("black");
    const whiteCount = state.phase==="opening" ? state.openingRemaining.white : reserveCount("white");
    blackBtn.querySelector("small").textContent=`${blackCount} available`;
    whiteBtn.querySelector("small").textContent=`${whiteCount} available`;
    blackBtn.disabled = !state.choosingColour || isComputer(state.colourChooser) || !availableChoiceColours().includes("black") || !!state.pendingSwap;
    whiteBtn.disabled = !state.choosingColour || isComputer(state.colourChooser) || !availableChoiceColours().includes("white") || !!state.pendingSwap;
    blackBtn.querySelector(".mini-piece").style.background=colourCss("black");
    whiteBtn.querySelector(".mini-piece").style.background=colourCss("white");

    // A fixed colour is an instruction, even though its button cannot be clicked.
    const activeColour = state.winner === null && !state.pendingSwap && !state.choosingColour
      ? (state.redeployPiece?.colour || state.assignedColour) : null;
    const jumpChoice = state.consequence?.type === "jump-choice" && state.choosingColour;
    el("reserve-heading").textContent = state.winner !== null ? "Colours"
      : state.pendingSwap ? "Position decision"
      : state.choosingColour ? (jumpChoice ? "Choose piece to place" : "Choose a colour")
      : "Colour to use";
    for (const [colour, button] of [["black", blackBtn], ["white", whiteBtn]]) {
      const required = activeColour === colour;
      button.classList.toggle("reserve-button--required", required);
      button.setAttribute("aria-label", `${colourName(colour)}${required ? ": colour to use" : ""}`);
      button.querySelector(".mini-piece").classList.toggle("piece--special",
        state.phase === "opening" || (required && !!state.redeployPiece?.special) ||
        (required && state.selectedReserveIndex !== null && CORNERS.includes(state.selectedReserveIndex)));
      if (required) button.querySelector("small").textContent = state.redeployPiece
        ? "Place jumped piece" : state.phase === "opening" ? "Place Opening Four piece"
        : canMoveOrJump() ? "Use this colour" : "Place this piece";
      else if (jumpChoice) button.querySelector("small").textContent =
        colour === state.consequence.heldColour ? "Originally handed piece" : "Jumped piece";
    }

    reserveInfoEl.textContent = state.phase === "opening"
      ? "Four shaped starter pieces: 2 of each colour. The opponent chooses the colour; the player chooses the corner."
      : `${reserveTotal()} reserve pieces available · ${state.releasedCorners.filter(Boolean).length}/4 outer corners released · blocked inner corners cannot count in any winning pattern.`;

    swapBox.hidden = !state.pendingSwap || isComputer(state.pendingSwap?.decider);
    jumpChoiceBox.hidden = !(state.consequence?.type === "jump-choice" && state.choosingColour && !isComputer(state.colourChooser));
    if (!jumpChoiceBox.hidden) {
      const c=state.consequence;
      el("choose-handed").textContent=`Place handed ${colourName(c.heldColour)}`;
      el("choose-jumped").textContent=`Place jumped ${colourName(c.jumpedPiece.colour)}`;
    }
    undoBtn.disabled = !settings.undo || !history.length || state.winner!==null;
    renderBoard();
  }

  function startGame() {
    clearTimeout(timer); resultRecorded=false; nextPieceId=1; history=[]; state=freshState(); applyColours(); initialiseClock(); render(); processFlow();
  }

  function playTone(kind="move") {
    if (!settings.sound || !("AudioContext" in window || "webkitAudioContext" in window)) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx(), osc = ctx.createOscillator(), gain = ctx.createGain();
      const frequencies = { select: 320, place: 380, move: 440, jump: 520, win: 660 };
      const duration = kind === "win" ? .22 : kind === "jump" ? .14 : .08;
      osc.frequency.value = frequencies[kind] || frequencies.select;
      gain.gain.setValueAtTime(.025, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + duration);
      osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + duration);
      osc.addEventListener("ended", () => ctx.close());
    } catch (_) {}
  }

  function clockEnabled(){ return Number(settings.clockMinutes) > 0; }
  function decisionActor(){ if (!state || state.winner!==null) return null; if(state.pendingSwap) return state.pendingSwap.decider; return state.choosingColour ? state.colourChooser : state.currentPlayer; }
  function formatClock(ms){ const total=Math.max(0,Math.ceil(ms/1000)); return `${Math.floor(total/60)}:${String(total%60).padStart(2,"0")}`; }
  function stopClock(){ if(clockInterval) clearInterval(clockInterval); clockInterval=null; clockActivePlayer=null; clockLastTick=null; renderClocks(); }
  function settleClock(now=Date.now()){
    if(!clockEnabled() || clockActivePlayer===null || clockLastTick===null || state?.winner!==null) return null;
    const elapsed=Math.max(0,now-clockLastTick); clockRemainingMs[clockActivePlayer]=Math.max(0,clockRemainingMs[clockActivePlayer]-elapsed); clockLastTick=now;
    return clockRemainingMs[clockActivePlayer] <= 0 ? clockActivePlayer : null;
  }
  function initialiseClock(){ if(clockInterval) clearInterval(clockInterval); const initial=clockEnabled()?Number(settings.clockMinutes)*60000:0; clockRemainingMs=[initial,initial]; clockActivePlayer=null; clockLastTick=null; renderClocks(); }
  function restoreClock(snap){ if(clockInterval) clearInterval(clockInterval); const initial=clockEnabled()?Number(settings.clockMinutes)*60000:0; clockRemainingMs=snap?.remainingMs?[...snap.remainingMs]:[initial,initial]; clockActivePlayer=Number.isInteger(snap?.activePlayer)?snap.activePlayer:null; clockLastTick=clockActivePlayer===null?null:Date.now(); }
  function finishTimeLoss(expired){
    if(!state || state.winner!==null) return;
    clockRemainingMs[expired]=0; state.winner=other(expired); state.winType="time"; state.choosingColour=false;
    if(clockInterval) clearInterval(clockInterval); clockInterval=null; clockActivePlayer=null; clockLastTick=null;
    maybeRecordResult(); playTone("win"); render(); maybeOfferUpdate();
  }
  function syncClock(){
    if(!clockEnabled()){ if(clockInterval) clearInterval(clockInterval); clockInterval=null; clockActivePlayer=null; clockLastTick=null; renderClocks(); return; }
    const now=Date.now(), expired=settleClock(now); if(expired!==null){finishTimeLoss(expired);return;}
    const next=decisionActor(); if(next!==clockActivePlayer){ if(clockActivePlayer!==null) clockRemainingMs[clockActivePlayer]+=Math.max(0,Number(settings.clockIncrement)||0)*1000; clockActivePlayer=next; }
    clockLastTick=clockActivePlayer===null?null:now;
    if(!clockInterval && clockActivePlayer!==null) clockInterval=setInterval(()=>{const e=settleClock(); if(e!==null) finishTimeLoss(e); else renderClocks();},250);
    renderClocks();
  }
  function renderClocks(){
    const panel=el("chess-clocks"), row=document.querySelector(".turn-status-row"); if(!panel) return; const enabled=clockEnabled(); panel.hidden=!enabled; row?.classList.toggle("chess-clock-enabled",enabled); if(!enabled) return;
    for(let p=0;p<2;p++){ el(`clock-player-${p}-name`).textContent=playerName(p); el(`clock-player-${p}`).textContent=formatClock(clockRemainingMs[p]); const card=panel.querySelector(`[data-clock-player="${p}"]`); card?.classList.toggle("chess-clock-card--active",clockActivePlayer===p&&state?.winner===null); card?.classList.toggle("chess-clock-card--expired",clockRemainingMs[p]<=0); }
  }

  const STATS_KEY="lipfty14-stats";
  function emptyStats(){return{computer:{played:0,won:0,lost:0,drawn:0},two:{played:0,p1:0,p2:0,drawn:0}};}
  function loadStats(){try{const x=JSON.parse(localStorage.getItem(STATS_KEY)||"null"),b=emptyStats();return x?{computer:{...b.computer,...x.computer},two:{...b.two,...x.two}}:b;}catch(_){return emptyStats();}}
  function maybeRecordResult(){
    if(resultRecorded||state?.winner===null)return; resultRecorded=true; const stats=loadStats();
    if(settings.mode==="computer"){const x=stats.computer;x.played++;if(state.winner==="draw")x.drawn++;else if(state.winner===0)x.won++;else x.lost++;}
    else{const x=stats.two;x.played++;if(state.winner==="draw")x.drawn++;else if(state.winner===0)x.p1++;else x.p2++;}
    try{localStorage.setItem(STATS_KEY,JSON.stringify(stats));}catch(_){}
  }
  function renderStatistics(){const stats=loadStats(),box=el("statistics-content"),tile=(v,l)=>`<span><strong>${v}</strong><small>${l}</small></span>`;box.innerHTML=`<h3>Against the computer</h3><div class="statistics-summary">${tile(stats.computer.played,"Played")}${tile(stats.computer.won,"You won")}${tile(stats.computer.lost,"Computer won")}${tile(stats.computer.drawn,"Draws")}</div><h3>Two players</h3><div class="statistics-summary">${tile(stats.two.played,"Played")}${tile(stats.two.p1,"Player 1 won")}${tile(stats.two.p2,"Player 2 won")}${tile(stats.two.drawn,"Draws")}</div>`;}

  function jumpToEndTest(){
    clearTimeout(timer); resultRecorded=false; nextPieceId=1; history=[]; state=freshState();
    state.phase="main"; state.openingPlaced=4; state.openingRemaining={black:0,white:0}; state.swapDone=true;
    state.board=Array(36).fill(null);
    [[0,"black"],[5,"white"],[30,"white"],[35,"black"]].forEach(([i,c])=>state.board[i]={id:nextPieceId++,colour:c,pinned:true,special:true,anchor:true});
    const fallback=[[1,"black"],[2,"white"],[3,"white"],[4,"black"],[8,"black"],[11,"white"],[12,"black"],[14,"white"],[15,"black"],[16,"black"],[17,"white"],[19,"black"],[20,"black"],[21,"white"],[22,"white"],[23,"black"],[24,"white"],[25,"white"],[26,"white"],[27,"black"],[29,"white"],[31,"black"],[33,"black"],[34,"white"]];
    fallback.forEach(([i,c])=>state.board[i]={id:nextPieceId++,colour:c,pinned:false,special:false,anchor:false});
    state.reserve.active.fill(null); state.clearedEdges=[true,true,true,true]; [0,1,2,3].forEach(releaseCorner); state.releasedCorners=[true,true,true,true];
    state.currentPlayer=0; state.colourChooser=0; state.choosingColour=true; state.assignedColour=null; state.selectedReserveIndex=null;
    initialiseClock(); render(); processFlow();
  }

  blackBtn.addEventListener("click",()=>{playTone("select");chooseColour("black");});
  whiteBtn.addEventListener("click",()=>{playTone("select");chooseColour("white");});
  el("carry-on").addEventListener("click",()=>resolveSwap(false));
  el("swap-sides").addEventListener("click",()=>resolveSwap(true));
  el("choose-handed").addEventListener("click",()=>applyJumpChoice(state.consequence.heldColour));
  el("choose-jumped").addEventListener("click",()=>applyJumpChoice(state.consequence.jumpedPiece.colour));
  el("new-game").addEventListener("click",startGame); undoBtn.addEventListener("click",undo);

  let versionTaps=[]; function handleVersionTap(){const now=Date.now();versionTaps=versionTaps.filter(t=>now-t<=3000);versionTaps.push(now);if(versionTaps.length>=5){versionTaps=[];jumpToEndTest();}}
  [el("app-version"),el("mobile-version")].filter(Boolean).forEach(x=>x.addEventListener("click",handleVersionTap));

  const settingsDialog=el("settings-dialog"),settingsForm=el("settings-form"),wizardSteps=[...document.querySelectorAll("[data-wizard-step]")],wizardIndicators=[...document.querySelectorAll("[data-step-indicator]")];
  const wizardBack=el("wizard-back"),wizardNext=el("wizard-next"),wizardSave=el("wizard-save"),wizardDefault=el("wizard-default"); let wizardStep=0;
  const colourOptions=["red","blue","green","yellow","purple","orange","black","white"];
  function buildColours(id,name){const box=el(id);box.replaceChildren();for(const k of colourOptions){const l=document.createElement("label");l.className="colour-choice";l.innerHTML=`<input type="radio" name="${name}" value="${k}"><span><i class="colour-swatch" style="background:${COLOURS[k][1]}"></i>${COLOURS[k][0]}</span>`;box.appendChild(l);}}
  buildColours("colour1-choices","colour1");buildColours("colour2-choices","colour2");
  function fv(n){return settingsForm.querySelector(`[name="${n}"]:checked`)?.value;} function sr(n,v){const x=settingsForm.querySelector(`[name="${n}"][value="${v}"]`);if(x)x.checked=true;}
  function syncMode(){const one=fv("gameMode")==="computer";el("difficulty-field").hidden=!one;el("player2-label").hidden=one;el("player1-label-text").textContent=one?"Player name":"Player 1 name";el("starter-player-label").textContent=one?"Player":"Player 1";el("starter-other-label").textContent=one?"Computer":"Player 2";}
  function syncDifficulty(){const n=Number(el("difficulty-input").value),names=["","Beginner","Standard","Expert"];el("difficulty-name").textContent=`${n} · ${names[n]}`;}
  function syncClockOptions(){const enabled=Number(fv("clockMinutes")||0)>0;el("clock-increment-field").disabled=!enabled;if(!enabled)sr("clockIncrement","0");}
  function showStep(n){wizardStep=Math.max(0,Math.min(5,n));wizardSteps.forEach((x,i)=>x.hidden=i!==wizardStep);wizardIndicators.forEach((x,i)=>{x.classList.toggle("wizard-progress-step--active",i===wizardStep);x.classList.toggle("wizard-progress-step--complete",i<wizardStep);});wizardDefault.hidden=wizardStep!==0;wizardBack.hidden=wizardStep===0;wizardNext.hidden=wizardStep===5;wizardSave.hidden=false;if(wizardStep===5)summary();}
  function summary(){const one=fv("gameMode")==="computer",mins=Number(fv("clockMinutes")||0),inc=Number(fv("clockIncrement")||0),clock=mins?`${mins} min each${inc?` + ${inc}s`:""}`:"Clock off";el("setup-summary").textContent=`Lipfty · ${one?"Player vs Computer":"Two players"} · ${COLOURS[fv("colour1")][0]} / ${COLOURS[fv("colour2")][0]} · ${(fv("gameVersion")||"standard").replace(/^./,c=>c.toUpperCase())} · ${clock}`;}
  function loadForm(){sr("gameMode",settings.mode);el("difficulty-input").value=settings.level==="beginner"?1:settings.level==="expert"?3:2;sr("allowUndo",settings.undo?"yes":"no");sr("colour1",settings.colour1);sr("colour2",settings.colour2);sr("gameVersion",settings.version);el("setting-player1").value=settings.player1||"Player";el("setting-player2").value=settings.player2||"Player 2";sr("starter",settings.starter);sr("clockMinutes",String(settings.clockMinutes||0));sr("clockIncrement",String(settings.clockIncrement||0));el("setting-sound").checked=settings.sound!==false;el("setting-animations").checked=settings.animations!==false;el("setting-language").value=settings.language||"en-GB";syncMode();syncDifficulty();syncClockOptions();showStep(0);}
  function setDefaultForm(){
    const d=defaultSettings();
    sr("gameMode",d.mode); el("difficulty-input").value=d.level==="beginner"?1:d.level==="expert"?3:2;
    sr("allowUndo",d.undo?"yes":"no"); sr("colour1",d.colour1); sr("colour2",d.colour2); sr("gameVersion",d.version);
    el("setting-player1").value=d.player1; el("setting-player2").value=d.player2; sr("starter",d.starter);
    sr("clockMinutes",String(d.clockMinutes)); sr("clockIncrement",String(d.clockIncrement));
    el("setting-sound").checked=d.sound; el("setting-animations").checked=d.animations; el("setting-language").value=d.language;
    syncMode(); syncDifficulty(); syncClockOptions();
  }
  function commitSettings(){const c1=fv("colour1"),c2=fv("colour2");if(!c1||!c2||c1===c2){showStep(1);statusEl.textContent="Choose two different piece colours.";return false;}const n=Number(el("difficulty-input").value);settings={...settings,mode:fv("gameMode"),level:n===1?"beginner":n===3?"expert":"standard",version:fv("gameVersion")||"standard",starter:fv("starter")||"random",player1:el("setting-player1").value.trim()||"Player",player2:el("setting-player2").value.trim()||"Player 2",colour1:c1,colour2:c2,clockMinutes:Number(fv("clockMinutes")||0),clockIncrement:Number(fv("clockIncrement")||0),sound:el("setting-sound").checked,animations:el("setting-animations").checked,language:el("setting-language").value,undo:fv("allowUndo")==="yes",colourDefaultsVersion:1403};saveSettings();settingsDialog.close();startGame();return true;}
  el("settings-button").addEventListener("click",()=>{loadForm();settingsDialog.showModal();});el("close-settings").addEventListener("click",()=>settingsDialog.close());wizardBack.addEventListener("click",()=>showStep(wizardStep-1));wizardNext.addEventListener("click",()=>{if(wizardStep===1&&fv("colour1")===fv("colour2")){statusEl.textContent="Choose two different piece colours.";return;}showStep(wizardStep+1);});wizardDefault.addEventListener("click",setDefaultForm);settingsForm.addEventListener("submit",e=>{e.preventDefault();commitSettings();});
  wizardIndicators.forEach((x,i)=>{x.setAttribute("role","button");x.tabIndex=0;x.addEventListener("click",()=>showStep(i));x.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();showStep(i);}});});
  settingsForm.querySelectorAll('[name="gameMode"]').forEach(x=>x.addEventListener("change",syncMode));el("difficulty-input").addEventListener("input",syncDifficulty);settingsForm.querySelectorAll('[name="clockMinutes"]').forEach(x=>x.addEventListener("change",syncClockOptions));

  el("help-button").addEventListener("click",()=>el("help-dialog").showModal());el("close-help").addEventListener("click",()=>el("help-dialog").close());
  el("view-statistics-button").addEventListener("click",()=>{renderStatistics();el("statistics-dialog").showModal();});el("close-statistics").addEventListener("click",()=>el("statistics-dialog").close());el("reset-statistics").addEventListener("click",()=>{if(confirm("Reset all Lipfty statistics on this device?")){localStorage.removeItem(STATS_KEY);renderStatistics();}});

  fetch("./build-info.json",{cache:"no-store"}).then(r=>r.ok?r.json():null).then(info=>{const v=info?.version||"14.0.7";el("app-version").textContent=`Version ${v}`;el("mobile-version").textContent=`v${v}`;const ref=info?.commit||info?.gitCommit||"";el("build-reference").textContent=ref?` · ${String(ref).slice(0,7)}`:"";}).catch(()=>{el("app-version").textContent="Version 14.0.7";});
  let pendingUpdateRegistration = null;
  let updatePromptHandled = false;
  let reloadingForUpdate = false;
  function gameIsInProgress(){
    return !!state && state.winner === null && (state.openingPlaced > 0 || state.board.some(Boolean) || reserveTotal() < 24);
  }
  function maybeOfferUpdate(){
    const registration = pendingUpdateRegistration;
    if (updatePromptHandled || !registration?.waiting || gameIsInProgress()) return;
    updatePromptHandled = true;
    if (confirm("A new version of Lipfty is available. Update now?")) {
      registration.waiting.postMessage({type:"SKIP_WAITING"});
    }
  }
  function registerServiceWorker(){
    if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
    navigator.serviceWorker.addEventListener("controllerchange",()=>{
      if (reloadingForUpdate) return;
      reloadingForUpdate = true;
      location.reload();
    });
    navigator.serviceWorker.register("service-worker.js",{scope:"./"}).then(registration=>{
      const rememberWaiting = () => { pendingUpdateRegistration = registration; maybeOfferUpdate(); };
      if (registration.waiting) rememberWaiting();
      registration.addEventListener("updatefound",()=>{
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener("statechange",()=>{
          if (worker.state === "installed" && navigator.serviceWorker.controller) rememberWaiting();
        });
      });
    }).catch(()=>{});
  }

  registerServiceWorker();
  startGame();
})();

