const utils = require('../utils');

const thalaswapAddress =
  '0x48271d39d0b05bd6efca2278f22277d6fcc375504f9839fd73f74ace240861af';
const THALA_DAPP_URL = 'http://app.thala.fi';
const THALA_POOL_API_URL = `${THALA_DAPP_URL}/api/liquidity-pool`;
const THALA_COIN_INFO_URL = `${THALA_DAPP_URL}/api/coin-info`;
const stablePoolType = `${thalaswapAddress}::stable_pool::StablePool<`;
const weightedPoolType = `${thalaswapAddress}::weighted_pool::WeightedPool<`;

const coinInfoCache = {};

async function main() {
  // We use Thala's API and not resources on chain as there are too many pools to parse and query
  // for TVL, APR, etc. metrics. This way we fetch all our pools with TVL attached, then can filter.
  const liquidityPools = (await utils.getData(`${THALA_POOL_API_URL}s`))
      ?.data;
  if (!liquidityPools) {
    return [];
  }
  const filteredPools = liquidityPools.filter((pool) => pool.tvl > 10000);
  const v1Pools = filteredPools.filter((pool) => pool.metadata.isV2 === false);

  const tvlArr = [];
  for (const liquidityPool of v1Pools) {
    const swapFeesApr = liquidityPool.apr.find(item => item.source === 'Swap Fees')?.apr;
    const farmingTHLApr = liquidityPool.apr.find(item => item.source === 'THL')?.apr;
    const farmingTHAPTApr = liquidityPool.apr.find(item => item.source === 'thAPT')?.apr;
    const rewardTokens = [];

    // Check and push for THL
    if (farmingTHLApr > 0) {
        rewardTokens.push('0x7fd500c11216f0fe3095d0c4b8aa4d64a4e2e04f83758462f2b127255643615::thl_coin::THL');
    }
    // Check and push for thAPT
    if (farmingTHAPTApr > 0) {
        rewardTokens.push('0xfaf4e633ae9eb31366c9ca24214231760926576c7b625313b3688b5e900731f6::staking::ThalaAPT');
    }
    const coinInfos = await Promise.all(liquidityPool.metadata.coinAddresses.map(async (address) => await getCoinInfoWithCache(address)));
    const coinNames = coinInfos.map((coinInfo) => coinInfo.symbol).join('-');
    tvlArr.push({
      pool:
      (liquidityPool.metadata.poolType === 'Stable' ? stablePoolType : weightedPoolType) +
      coinNames +
      '>',
      chain: utils.formatChain('aptos'),
      project: 'thalaswap',
      apyBase: (swapFeesApr ?? 0) * 100,
      apyReward: ((farmingTHLApr ?? 0) + (farmingTHAPTApr ?? 0)) * 100,
      rewardTokens,
      symbol: coinNames,
      tvlUsd: liquidityPool.tvl,
      underlyingTokens: liquidityPool.metadata.coinAddresses,
      url: `${THALA_DAPP_URL}/pools/${liquidityPool.metadata.type}`,
    });
  }

  return tvlArr;
}

async function getCoinInfoWithCache(coinAddress) {
  if (coinInfoCache[coinAddress]) {
    return coinInfoCache[coinAddress];
  }
  
  const coinInfo = await utils.getData(`${THALA_COIN_INFO_URL}?coin=${coinAddress}`);
  coinInfoCache[coinAddress] = coinInfo?.data;

  return coinInfo?.data;
}

module.exports = {
  timetravel: false,
  apy: main,
  url: 'https://app.thala.fi/pools',
};
