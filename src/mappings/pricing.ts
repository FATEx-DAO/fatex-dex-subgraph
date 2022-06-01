/* eslint-disable prefer-const */
import { Pair, Token, Bundle, PairAddressMap } from '../types/schema'
import { BigDecimal, BigInt } from '@graphprotocol/graph-ts/index'
import { ZERO_BD, ONE_BD } from './helpers'

const WMATIC_ADDRESS = '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270'
const USDC_WMATIC_PAIR = '0xfdf6f1a2d3a0a24807de2cdb3afd2a813920436e'
const BUSD_WMATIC_PAIR = ''
const USDT_WMATIC_PAIR = ''

export function getOnePriceInUSD(): BigDecimal {
  // fetch eth prices for each stablecoin
  let usdcPair = Pair.load(USDC_WMATIC_PAIR) // usdc is token1
  let busdPair = Pair.load(BUSD_WMATIC_PAIR) // busd is token1
  let usdtPair = Pair.load(USDT_WMATIC_PAIR) // usdt is token0

  // all 3 have been created
  if (usdcPair !== null && busdPair !== null && usdtPair !== null) {
    let totalLiquidityETH = usdcPair.reserve0.plus(busdPair.reserve0).plus(usdtPair.reserve1)
    let usdcWeight = usdcPair.reserve0.div(totalLiquidityETH)
    let busdWeight = busdPair.reserve0.div(totalLiquidityETH)
    let usdtWeight = usdtPair.reserve1.div(totalLiquidityETH)
    return usdcPair.token1Price
      .times(usdcWeight)
      .plus(busdPair.token1Price.times(busdWeight))
      .plus(usdtPair.token0Price.times(usdtWeight))
    // dai and USDC have been created
  } else if (usdcPair !== null && busdPair !== null) {
    let totalLiquidityETH = usdcPair.reserve0.plus(busdPair.reserve0)
    let usdcWeight = usdcPair.reserve0.div(totalLiquidityETH)
    let busdWeight = busdPair.reserve0.div(totalLiquidityETH)
    return usdcPair.token1Price.times(usdcWeight).plus(busdPair.token1Price.times(busdWeight))
    // USDC is the only pair so far
  } else if (usdcPair !== null) {
    return usdcPair.token1Price
  } else {
    return ZERO_BD
  }
}

// token where amounts should contribute to tracked volume and liquidity
let WHITELIST: string[] = [
  WMATIC_ADDRESS,
  '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619', // WETH
  '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', // USDC
  '0x553d3d295e0f695b9228246232edf400ed3560b5', // PAXG
]

// minimum liquidity required to count towards tracked volume for pairs with small # of Lps
let MINIMUM_USD_THRESHOLD_NEW_PAIRS = BigDecimal.fromString('100')

// minimum liquidity for price to get tracked
let MINIMUM_LIQUIDITY_THRESHOLD_MATIC = BigDecimal.fromString('1')

/**
 * Search through graph to find derived Eth per token.
 * @todo update to be derived ETH (add stablecoin estimates)
 **/
export function findMaticPerToken(token: Token): BigDecimal {
  if (token.id == WMATIC_ADDRESS) {
    return ONE_BD
  }
  // loop through whitelist and check if paired with any
  for (let i = 0; i < WHITELIST.length; i++) {
    let pairAddressResult = PairAddressMap.load(token.id.concat('-').concat(WHITELIST[i]))
    if (pairAddressResult != null) {
      let pair = Pair.load(pairAddressResult.pairAddress.toHexString()) as Pair
      if (pair.token0 == token.id && pair.reserveETH.gt(MINIMUM_LIQUIDITY_THRESHOLD_MATIC)) {
        let token1 = Token.load(pair.token1) as Token
        return pair.token1Price.times(token1.derivedETH as BigDecimal) // return token1 per our token * Eth per token 1
      }
      if (pair.token1 == token.id && pair.reserveETH.gt(MINIMUM_LIQUIDITY_THRESHOLD_MATIC)) {
        let token0 = Token.load(pair.token0) as Token
        return pair.token0Price.times(token0.derivedETH as BigDecimal) // return token0 per our token * ETH per token 0
      }
    }
  }
  return ZERO_BD // nothing was found return 0
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD.
 * If both are, return average of two amounts
 * If neither is, return 0
 */
export function getTrackedVolumeUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token,
  pair: Pair
): BigDecimal {
  let bundle = Bundle.load('1') as Bundle
  let price0 = (token0.derivedETH as BigDecimal).times(bundle.ethPrice)
  let price1 = (token1.derivedETH as BigDecimal).times(bundle.ethPrice)

  // if less than 5 LPs, require high minimum reserve amount amount or return 0
  if (pair.liquidityProviderCount.lt(BigInt.fromI32(1))) {
    let reserve0USD = pair.reserve0.times(price0)
    let reserve1USD = pair.reserve1.times(price1)
    if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
      if (reserve0USD.plus(reserve1USD).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return ZERO_BD
      }
    }
    if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
      if (reserve0USD.times(BigDecimal.fromString('2')).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return ZERO_BD
      }
    }
    if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
      if (reserve1USD.times(BigDecimal.fromString('2')).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return ZERO_BD
      }
    }
  }

  // both are whitelist tokens, take average of both amounts
  if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount0
      .times(price0)
      .plus(tokenAmount1.times(price1))
      .div(BigDecimal.fromString('2'))
  }

  // take full value of the whitelisted token amount
  if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0)
  }

  // take full value of the whitelisted token amount
  if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount1.times(price1)
  }

  // neither token is on white list, tracked volume is 0
  return ZERO_BD
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD * 2.
 * If both are, return sum of two amounts
 * If neither is, return 0
 */
export function getTrackedLiquidityUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token
): BigDecimal {
  let bundle = Bundle.load('1') as Bundle
  let price0 = (token0.derivedETH as BigDecimal).times(bundle.ethPrice)
  let price1 = (token1.derivedETH as BigDecimal).times(bundle.ethPrice)

  // both are whitelist tokens, take average of both amounts
  if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0).plus(tokenAmount1.times(price1))
  }

  // take double value of the whitelisted token amount
  if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0).times(BigDecimal.fromString('2'))
  }

  // take double value of the whitelisted token amount
  if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount1.times(price1).times(BigDecimal.fromString('2'))
  }

  // neither token is on white list, tracked volume is 0
  return ZERO_BD
}
