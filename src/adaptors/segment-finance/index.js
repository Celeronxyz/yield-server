const superagent = require('superagent');
const sdk = require('@defillama/sdk');

const utils = require('../utils');
const { comptrollerAbi, ercDelegator } = require('../compound-v2/abi');

const COMPTROLLER_ADDRESS = '0xcD7C4F508652f33295F0aEd075936Cd95A4D2911';
const CHAIN = 'bob';
const GET_ALL_MARKETS = 'getAllMarkets';
const SUPPLY_RATE = 'supplyRatePerBlock';
const BORROW_RATE = 'borrowRatePerBlock';
const TOTAL_BORROWS = 'totalBorrows';
const TOTAL_RESERVES = 'totalReserves';
const GET_CHASH = 'getCash';
const UNDERLYING = 'underlying';
const BLOCKS_PER_DAY = 86400 / 2;
const PROJECT_NAME = 'segment-finance';

const NATIVE_TOKEN = {
  decimals: 18,
  symbol: 'WETH',
  address: '0x4200000000000000000000000000000000000006'.toLowerCase(),
};

const getPrices = async (addresses) => {
  const prices = (
    await superagent.get(
      `https://coins.llama.fi/prices/current/${addresses
        .join(',')
        .toLowerCase()}`
    )
  ).body.coins;

  const pricesByAddress = Object.entries(prices).reduce(
    (acc, [name, price]) => ({
      ...acc,
      [name.split(':')[1]]: price.price,
    }),
    {}
  );

  return pricesByAddress;
};

const calculateApy = (ratePerTimestamps) => {
  const blocksPerDay = BLOCKS_PER_DAY;
  const daysPerYear = 365;

  return (
    (Math.pow(ratePerTimestamps * blocksPerDay + 1, daysPerYear) - 1) * 100
  );
};

const getRewards = async (markets, rewardMethod) => {
  return (
    await sdk.api.abi.multiCall({
      chain: CHAIN,
      calls: markets.map((market) => ({
        target: COMPTROLLER_ADDRESS,
        params: [market],
      })),
      abi: comptrollerAbi.find(({ name }) => name === rewardMethod),
      permitFailure: true,
    })
  ).output.map(({ output }) => output);
};

const multiCallMarkets = async (markets, method, abi) => {
  return (
    await sdk.api.abi.multiCall({
      chain: CHAIN,
      calls: markets.map((market) => ({ target: market })),
      abi: abi.find(({ name }) => name === method),
      permitFailure: true,
    })
  ).output.map(({ output }) => output);
};

const main = async () => {
  const allMarketsRes = (
    await sdk.api.abi.call({
      target: COMPTROLLER_ADDRESS,
      chain: CHAIN,
      abi: comptrollerAbi.find(({ name }) => name === GET_ALL_MARKETS),
      permitFailure: true,
    })
  ).output;
  const allMarkets = Object.values(allMarketsRes);

  const markets = (
    await sdk.api.abi.multiCall({
      chain: CHAIN,
      abi: comptrollerAbi.find((n) => n.name === 'markets'),
      calls: allMarkets.map((m) => ({
        target: COMPTROLLER_ADDRESS,
        params: [m],
      })),
      permitFailure: true,
    })
  ).output.map((o) => o.output);

  const borrowCaps = (
    await sdk.api.abi.multiCall({
      chain: CHAIN,
      abi: comptrollerAbi.find((n) => n.name === 'borrowCaps'),
      calls: allMarkets.map((m) => ({
        target: COMPTROLLER_ADDRESS,
        params: [m],
      })),
      permitFailure: true,
    })
  ).output.map((o) => o.output);

  const isPaused = await getRewards(allMarkets, 'mintGuardianPaused');

  const supplyRewards = await multiCallMarkets(
    allMarkets,
    SUPPLY_RATE,
    ercDelegator
  );

  const borrowRewards = await multiCallMarkets(
    allMarkets,
    BORROW_RATE,
    ercDelegator
  );

  const marketsCash = await multiCallMarkets(
    allMarkets,
    GET_CHASH,
    ercDelegator
  );
  const totalBorrows = await multiCallMarkets(
    allMarkets,
    TOTAL_BORROWS,
    ercDelegator
  );
  const totalReserves = await multiCallMarkets(
    allMarkets,
    TOTAL_RESERVES,
    ercDelegator
  );

  const underlyingTokens = await multiCallMarkets(
    allMarkets,
    UNDERLYING,
    ercDelegator
  );

  const underlyingSymbols = await multiCallMarkets(
    underlyingTokens,
    'symbol',
    ercDelegator
  );
  const underlyingDecimals = await multiCallMarkets(
    underlyingTokens,
    'decimals',
    ercDelegator
  );

  const prices = await getPrices(
    underlyingTokens
      .concat([NATIVE_TOKEN.address])
      .map((token) => `${CHAIN}:` + token)
  );

  const pools = allMarkets.map((market, i) => {
    const token = underlyingTokens[i] || NATIVE_TOKEN.address;
    const symbol = underlyingSymbols[i] || NATIVE_TOKEN.symbol;

    const decimals = Number(underlyingDecimals[i]) || NATIVE_TOKEN.decimals;
    let price = prices[token.toLowerCase()];
    if (price === undefined)
      price = symbol.toLowerCase().includes('usd') ? 1 : 0;

    const totalSupplyUsd =
      ((Number(marketsCash[i]) +
        Number(totalBorrows[i]) -
        Number(totalReserves[i])) /
        10 ** decimals) *
      price;

    const totalBorrowUsd = (Number(totalBorrows[i]) / 10 ** decimals) * price;
    const tvlUsd = totalSupplyUsd - totalBorrowUsd;

    const apyBase = calculateApy(supplyRewards[i] / 10 ** 18);
    const apyBaseBorrow = calculateApy(borrowRewards[i] / 10 ** 18);

    let poolReturned = {
      pool: market.toLowerCase(),
      chain: utils.formatChain(CHAIN),
      project: PROJECT_NAME,
      symbol,
      tvlUsd,
      apyBase,
      underlyingTokens: [token],
      rewardTokens: [],
      url: 'https://app.segment.finance/#//market/' + market,
    };
    if (isPaused[i] === false) {
      poolReturned = {
        ...poolReturned,
        // borrow fields
        totalSupplyUsd,
        totalBorrowUsd,
        apyBaseBorrow,
        ltv: Number(markets[i].collateralFactorMantissa) / 1e18,
        debtCeilingUsd: (borrowCaps[i] / 1e18) * price,
      };
    }
    return poolReturned;
  });

  return pools;
};

module.exports = {
  timetravel: false,
  apy: main,
};
