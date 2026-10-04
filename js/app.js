(function () {
  "use strict";

  const R = window.LipftyRules;
  const CORNERS = [0, 7, 56, 63];
  const ANCHORS = [0, 5, 30, 35];
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
  const phaseEl = el("phase-label");
  const blackBtn = el("choose-black");
  const whiteBtn = el("choose-white");
  const undoBtn = el("undo");
  const swapBox = el("swap-box");
  const jumpChoiceBox = el("jump-choice-box");

  let nextPieceId = 1;
  let state;
  let history = [];
  let timer = null;

  function defaultSettings() {
    return { mode: "computer", level: "standard", version: "standard", starter: "random", colour1: "red", colour2: "blue", colourDefaultsVersion: 1403, undo: true };
  }
  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem("lipfty14-settings") || "{}");
      // v14.0.3 restores Red / Blue as the Lipfty default. Existing installs
      // that are still on the old v14.0.2 Black / White default migrate once;
      // later explicit colour choices are preserved by the marker below.
      if (saved.colourDefaultsVersion !== 1403) {
        if ((saved.colour1 === undefined || saved.colour1 === "black") &&
            (saved.colour2 === undefined || saved.colour2 === "white")) {
          saved.colour1 = "red";
          saved.colour2 = "blue";
        }
        saved.colourDefaultsVersion = 1403;
        localStorage.setItem("lipfty14-settings", JSON.stringify(saved));
      }
      return { ...defaultSettings(), ...saved };
    } catch (_) { return defaultSettings(); }
  }
  let settings = loadSettings();

  function colourCss(c) { return COLOURS[c === "black" ? settings.colour1 : settings.colour2][1]; }
  function colourName(c) { return COLOURS[c === "black" ? settings.colour1 : settings.colour2][0]; }

  function hexToRgb(hex) {
    const value = hex.replace("#", "");
    return { r: parseInt(value.slice(0,2),16), g: parseInt(value.slice(2,4),16), b: parseInt(value.slice(4,6),16) };
  }
  function rgbToHex({r,g,b}) {
    const part = value => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2,"0");
    return `#${part(r)}${part(g)}${part(b)}`;
  }
  function mixHex(a, b, amount) {
    const ca = hexToRgb(a), cb = hexToRgb(b);
    return rgbToHex({
      r: ca.r + (cb.r-ca.r)*amount,
      g: ca.g + (cb.g-ca.g)*amount,
      b: ca.b + (cb.b-ca.b)*amount
    });
  }
  function relativeLuminance(hex) {
    const {r,g,b} = hexToRgb(hex);
    const channel = value => {
      const c = value / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126*channel(r) + 0.7152*channel(g) + 0.0722*channel(b);
  }
  function applyColours() {
    const first = colourCss("black"), second = colourCss("white");
    document.documentElement.style.setProperty("--piece-black", first);
    document.documentElement.style.setProperty("--piece-white", second);

    // The board follows the selected Lipfty colours. Each square is a muted
    // blend of both piece colours, so Black/White naturally becomes greyscale
    // while Red/Blue becomes a subdued red-blue / violet board.
    const blendA = mixHex(first, second, 0.38);
    const blendB = mixHex(first, second, 0.62);
    const neutral = "#808080";
    const lightBase = mixHex(blendA, neutral, 0.30);
    const darkBase = mixHex(blendB, neutral, 0.38);
    const light = mixHex(lightBase, "#ffffff", 0.62);
    const dark = mixHex(darkBase, "#000000", 0.28);
    const frame = mixHex(mixHex(first, second, 0.50), "#000000", 0.58);
    document.documentElement.style.setProperty("--board-light", light);
    document.documentElement.style.setProperty("--board-dark", dark);
    document.documentElement.style.setProperty("--board-frame", frame);
    document.documentElement.style.setProperty("--piece-black-outline", relativeLuminance(first) < 0.34 ? "rgba(255,255,255,.72)" : "rgba(0,0,0,.62)");
    document.documentElement.style.setProperty("--piece-white-outline", relativeLuminance(second) < 0.34 ? "rgba(255,255,255,.72)" : "rgba(0,0,0,.62)");
  }
  function isComputer(p) { return settings.mode === "computer" && p === 1; }
  function playerName(p) { return isComputer(p) ? "Computer" : (p === 0 ? "Player 1" : "Player 2"); }
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
    if (settings.starter === "p1") return 0;
    if (settings.starter === "p2") return 1;
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
    history.push(cloneState(state));
    if (history.length > 60) history.shift();
  }
  function undo() {
    if (!settings.undo || !history.length || isComputer(state.currentPlayer)) return;
    clearTimeout(timer);
    state = history.pop();
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
    render();
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
    render();
  }

  function afterOpeningPlacement(placer) {
    // Opening Four is setup only: complete all four corner placements before
    // the Lipfty take/accept decision becomes available.
    const next = other(placer);
    state.currentPlayer = next;
    state.colourChooser = placer;
    state.choosingColour = true;
    state.assignedColour = null;
    if (state.openingPlaced >= 4) state.phase = "main";
    render(); processFlow();
  }

  function placeOpening(index) {
    if (state.phase !== "opening" || state.choosingColour || !ANCHORS.includes(index) || state.board[index]) return;
    checkpoint();
    const colour = state.assignedColour;
    if (!colour || state.openingRemaining[colour] <= 0) return;
    state.board[index] = { id: nextPieceId++, colour, pinned: true, special: true, anchor: true };
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

  function computerChooseColour() {
    if (!isComputer(state.colourChooser) || !state.choosingColour) return;
    if (state.consequence?.type === "jump-choice") {
      const c = state.consequence;
      const choices = [c.heldColour, c.jumpedPiece.colour];
      applyJumpChoice(choices[Math.floor(Math.random()*choices.length)]); return;
    }
    const colours = availableChoiceColours();
    if (!colours.length) { finishDraw(); return; }
    chooseColour(colours[Math.floor(Math.random()*colours.length)]);
  }

  function actionWouldWin(action) {
    const b = state.board.map(p => p ? {...p} : null);
    if (action.type === "place") b[action.to] = { colour: state.assignedColour };
    else {
      const p = b[action.from]; b[action.from] = null; b[action.to] = p;
      if (action.type === "jump") b[action.over] = null;
    }
    return !!R.checkWin(b, ruleOptions());
  }

  function computerPlay() {
    if (!isComputer(state.currentPlayer) || state.choosingColour || state.winner !== null) return;
    if (state.phase === "opening") {
      const choices = ANCHORS.filter(i => !state.board[i]);
      placeOpening(choices[Math.floor(Math.random()*choices.length)]); return;
    }
    if (state.redeployPiece) {
      const empties = state.board.map((p,i)=>p?null:i).filter(i=>i!==null);
      placePiece(empties[Math.floor(Math.random()*empties.length)]); return;
    }
    const actions = [];
    for (let i=0;i<36;i++) if (!state.board[i] && state.selectedReserveIndex !== null) actions.push({type:"place",to:i});
    if (canMoveOrJump()) {
      for (let from=0;from<36;from++) {
        const p=state.board[from];
        if (!p || p.colour!==state.assignedColour || p.pinned || p.id===state.protectedPieceId) continue;
        R.adjacentDestinations(state.board,from).forEach(to=>actions.push({type:"move",from,to}));
        R.jumpDestinations(state.board,from).filter(j=>state.board[j.over]&&!state.board[j.over].pinned&&state.board[j.over].colour!==p.colour)
          .forEach(j=>actions.push({type:"jump",from,to:j.to,over:j.over}));
      }
    }
    if (!actions.length) { finishDraw(); return; }
    const wins = actions.filter(actionWouldWin);
    const pool = wins.length ? wins : actions;
    const a = pool[Math.floor(Math.random()*pool.length)];
    if (a.type === "place") placePiece(a.to);
    else { selectBoardPiece(a.from); moveOrJump(a.to); }
  }

  function processFlow() {
    clearTimeout(timer);
    if (state.winner !== null) return;
    if (state.pendingSwap) {
      if (isComputer(state.pendingSwap.decider)) timer = setTimeout(()=>resolveSwap(Math.random()<0.5),180);
      return;
    }
    if (state.choosingColour && isComputer(state.colourChooser)) { timer = setTimeout(computerChooseColour,180); return; }
    if (!state.choosingColour && isComputer(state.currentPlayer)) { timer = setTimeout(computerPlay,220); }
  }

  function statusText() {
    if (state.winner === "draw") return "Draw — every reserve piece has been used without a win.";
    if (state.winner !== null) return `${playerName(state.winner)} wins${state.winType === "square" ? " with a square" : " with four in a row"}.`;
    if (state.pendingSwap) return `${playerName(state.pendingSwap.decider)}: accept the first placement or take the position?`;
    if (state.phase === "opening") {
      if (state.choosingColour) return `${playerName(state.colourChooser)}: choose the colour ${playerName(state.currentPlayer)} must place as an Opening Four piece.`;
      return `${playerName(state.currentPlayer)}: place the ${colourName(state.assignedColour)} Opening Four piece on any empty 6×6 corner.`;
    }
    if (state.consequence?.type === "jump-choice" && state.choosingColour) return `${playerName(state.currentPlayer)}: choose which piece you will place after the Jump.`;
    if (state.choosingColour) return `${playerName(state.colourChooser)}: choose a reserve piece/colour for ${playerName(state.currentPlayer)}.`;
    if (state.redeployPiece) return `${playerName(state.currentPlayer)}: place the jumped ${colourName(state.redeployPiece.colour)} piece on any empty square.`;
    if (state.consequence?.type === "move" && state.consequence.step === 2) return `${playerName(state.currentPlayer)}: now place the piece you were originally handed.`;
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
    currentEl.textContent = state.winner===null ? playerName(state.currentPlayer) : "Game over";
    phaseEl.textContent = state.phase === "opening" ? `Opening Four · ${state.openingPlaced}/4 placed` : "Main game";
    statusEl.textContent = statusText() + (state.lastReleaseMessage ? ` ${state.lastReleaseMessage}.` : "");
    state.lastReleaseMessage = "";

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
    clearTimeout(timer); nextPieceId=1; history=[]; state=freshState(); applyColours(); render(); processFlow();
  }

  blackBtn.addEventListener("click",()=>chooseColour("black"));
  whiteBtn.addEventListener("click",()=>chooseColour("white"));
  el("carry-on").addEventListener("click",()=>resolveSwap(false));
  el("swap-sides").addEventListener("click",()=>resolveSwap(true));
  el("choose-handed").addEventListener("click",()=>applyJumpChoice(state.consequence.heldColour));
  el("choose-jumped").addEventListener("click",()=>applyJumpChoice(state.consequence.jumpedPiece.colour));
  el("new-game").addEventListener("click",startGame);
  undoBtn.addEventListener("click",undo);

  const settingsDialog=el("settings-dialog");
  el("settings-button").addEventListener("click",()=>{
    el("setting-mode").value=settings.mode; el("setting-level").value=settings.level; el("setting-version").value=settings.version;
    el("setting-starter").value=settings.starter; el("setting-colour1").value=settings.colour1; el("setting-colour2").value=settings.colour2;
    el("setting-undo").checked=settings.undo; settingsDialog.showModal();
  });
  el("settings-cancel").addEventListener("click",()=>settingsDialog.close());
  el("settings-form").addEventListener("submit",e=>{
    e.preventDefault();
    const c1=el("setting-colour1").value,c2=el("setting-colour2").value;
    if(c1===c2){el("settings-error").textContent="Choose two different colours.";return;}
    settings={mode:el("setting-mode").value,level:el("setting-level").value,version:el("setting-version").value,starter:el("setting-starter").value,colour1:c1,colour2:c2,colourDefaultsVersion:1403,undo:el("setting-undo").checked};
    localStorage.setItem("lipfty14-settings",JSON.stringify(settings)); settingsDialog.close(); startGame();
  });

  fetch("./build-info.json",{cache:"no-store"}).then(r=>r.ok?r.json():null).then(info=>{
    el("version").textContent=`v${info?.version || "14.0.3"}`;
  }).catch(()=>el("version").textContent="v14.0.3");

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("service-worker.js", { scope: "./" }).catch(()=>{});
  }

  startGame();
})();
