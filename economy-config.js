"use strict";

const DEFAULT_COINS = 25;
const MAX_LIVES = 5;
const LIFE_RECHARGE_MS = 30 * 60 * 1000;
const REWARDED_AD_COINS = 10;
const LETTER_REROLL_COST = 20;
const CATEGORY_REROLL_COST = 20;
const RANK_REWARDS = Object.freeze({
  1: 60,
  2: 40,
  3: 25,
  default: 10
});

const SHOP_OFFERS = Object.freeze({
  coins25: Object.freeze({ coins: 25, priceEur: 0.99 }),
  coins100: Object.freeze({ coins: 100, priceEur: 2.99 }),
  noAdsLifetime: Object.freeze({ bonusCoins: 100 })
});

module.exports = {
  DEFAULT_COINS,
  MAX_LIVES,
  LIFE_RECHARGE_MS,
  REWARDED_AD_COINS,
  LETTER_REROLL_COST,
  CATEGORY_REROLL_COST,
  RANK_REWARDS,
  SHOP_OFFERS
};
