(function () {
  "use strict";

  const SIZE = 6;
  const WIN_LENGTH = 4;
  const ANCHOR_SQUARES = [0, 5, 30, 35];

  function indexOf(r, c) { return r * SIZE + c; }
  function row(i) { return Math.floor(i / SIZE); }
  function col(i) { return i % SIZE; }
  function inBounds(r, c) { return r >= 0 && r < SIZE && c >= 0 && c < SIZE; }

  function buildStraightLines(directions) {
    const result = [];
    for (let r = 0; r < SIZE; r += 1) {
      for (let c = 0; c < SIZE; c += 1) {
        for (const [dr, dc] of directions) {
          const er = r + dr * (WIN_LENGTH - 1), ec = c + dc * (WIN_LENGTH - 1);
          if (!inBounds(er, ec)) continue;
          result.push(Array.from({ length: WIN_LENGTH }, (_, n) => indexOf(r + dr * n, c + dc * n)));
        }
      }
    }
    return result;
  }

  function buildAxisSquares() {
    const result = [];
    for (let side = 1; side < SIZE; side += 1) {
      for (let r = 0; r + side < SIZE; r += 1) {
        for (let c = 0; c + side < SIZE; c += 1) {
          result.push([indexOf(r,c), indexOf(r,c+side), indexOf(r+side,c+side), indexOf(r+side,c)]);
        }
      }
    }
    return result;
  }

  const ORTHOGONAL_LINES = buildStraightLines([[0,1],[1,0]]);
  const DIAGONAL_LINES = buildStraightLines([[1,1],[1,-1]]);
  const AXIS_SQUARES = buildAxisSquares();
  const TIGHT_SQUARES = AXIS_SQUARES.filter(p => Math.abs(col(p[1]) - col(p[0])) === 1);

  function allSameColour(board, pattern) {
    const pieces = pattern.map(i => board[i]);
    if (pieces.some(p => !p)) return null;
    const colour = pieces[0].colour;
    return pieces.every(p => p.colour === colour) ? colour : null;
  }

  function checkWin(board, options = {}) {
    const blocked = new Set(options.inactiveWinCells || []);
    const linePatterns = [...ORTHOGONAL_LINES];
    if (options.allowDiagonal !== false) linePatterns.push(...DIAGONAL_LINES);

    for (const pattern of linePatterns) {
      if (pattern.some(i => blocked.has(i))) continue;
      const colour = allSameColour(board, pattern);
      if (colour) return { line: [...pattern], colour, type: "line" };
    }

    if (options.allowSquare) {
      const patterns = options.allowSpacedSquare ? AXIS_SQUARES : TIGHT_SQUARES;
      for (const pattern of patterns) {
        if (pattern.some(i => blocked.has(i))) continue;
        const colour = allSameColour(board, pattern);
        if (colour) return { line: [...pattern], colour, type: "square" };
      }
    }
    return null;
  }

  function adjacentDestinations(board, from) {
    const result = [];
    const r = row(from), c = col(from);
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        if (!dr && !dc) continue;
        const nr = r + dr, nc = c + dc;
        if (inBounds(nr,nc)) {
          const to = indexOf(nr,nc);
          if (!board[to]) result.push(to);
        }
      }
    }
    return result;
  }

  function jumpDestinations(board, from) {
    const result = [];
    const r = row(from), c = col(from);
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        if (!dr && !dc) continue;
        const or = r + dr, oc = c + dc, lr = r + dr*2, lc = c + dc*2;
        if (!inBounds(or,oc) || !inBounds(lr,lc)) continue;
        const over = indexOf(or,oc), to = indexOf(lr,lc);
        if (board[over] && !board[to]) result.push({ over, to });
      }
    }
    return result;
  }

  window.LipftyRules = {
    SIZE, WIN_LENGTH, ANCHOR_SQUARES, ORTHOGONAL_LINES, DIAGONAL_LINES,
    TIGHT_SQUARES, AXIS_SQUARES, checkWin, adjacentDestinations, jumpDestinations
  };
})();
