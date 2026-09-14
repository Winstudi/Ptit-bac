"use strict";

const ALLOWED_FRAMES = new Set([
  "",
  "frame_purple_flame",
  "frame_ice",
  "frame_gold",
  "frame_nature"
]);

function normalizeFrameId(value) {
  const id = String(value || "").trim();
  return ALLOWED_FRAMES.has(id) ? id : "";
}

module.exports = {
  normalizeFrameId,
  allowedFrames: ALLOWED_FRAMES
};
