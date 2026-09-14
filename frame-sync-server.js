"use strict";

/*
 * P'tit Bac — validation serveur des cadres cosmétiques.
 * Le système de cadres reste disponible, mais aucun cadre n'est publié
 * dans le catalogue actuel. Une valeur vide signifie "Sans cadre".
 */
const ALLOWED_FRAMES = new Set([""]);

function normalizeFrameId(value) {
  const id = String(value || "").trim();
  return ALLOWED_FRAMES.has(id) ? id : "";
}

module.exports = {
  normalizeFrameId,
  allowedFrames: ALLOWED_FRAMES
};
