"use strict";

const { getPool, ensureDatabaseSchema } = require("./db.js");
const { createInventoryService } = require("./inventory-service.js");
const { createWalletAtomicService } = require("./wallet-atomic-service.js");
const { createRewardChestService } = require("./reward-chests-service.js");

module.exports = function installRewardChests(io) {
  const inventoryService = createInventoryService({
    getPool,
    ensureSchema:ensureDatabaseSchema
  });
  const walletAtomicService = createWalletAtomicService({
    getPool,
    ensureSchema:ensureDatabaseSchema
  });

  const service = createRewardChestService({
    getPool,
    ensureSchema:ensureDatabaseSchema,
    inventoryService,
    walletAtomicService,
    syncCoins:(token, value) => global.__ptbAdminSyncCoins?.(token, value),
    syncGems:(token, value) => global.__ptbAdminSyncGems?.(token, value)
  });

  // API interne pour le futur branchement aux niveaux / voie des trophées.
  // Aucun événement client ne peut réclamer une récompense réelle à ce stade.
  global.__ptbRewardChestService = service;

  io.on("connection", socket => {
    socket.on("rewards:config", (_payload = {}, cb = () => {}) => {
      cb({ ok:true, config:service.config() });
    });
  });

  return service;
};
