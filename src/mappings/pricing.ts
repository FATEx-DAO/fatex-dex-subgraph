/* eslint-disable prefer-const */
import { Pair, Token, Bundle, PairAddressMap } from '../types/schema'
import { BigDecimal, BigInt } from '@graphprotocol/graph-ts/index'
import { ZERO_BD, ONE_BD } from './helpers'

const WONE_ADDRESS = '0xcf664087a5bb0237a0bad6742852ec6c8d69a27a'
const USDC_WONE_PAIR = '0xe4c5d745896bce117ab741de5df4869de8bbf32f'
const BUSD_WONE_PAIR = '0x0000000000000000000000000000000000000000'
const USDT_WONE_PAIR = '0x0000000000000000000000000000000000000000'

export function getOnePriceInUSD(): BigDecimal {
  // fetch eth prices for each stablecoin
  let usdcPair = Pair.load(USDC_WONE_PAIR) // usdc is token0
  let busdPair = Pair.load(BUSD_WONE_PAIR) // busd is token1
  let usdtPair = Pair.load(USDT_WONE_PAIR) // usdt is token0

  // all 3 have been created
  if (usdcPair !== null && busdPair !== null && usdtPair !== null) {
    let totalLiquidityETH = usdcPair.reserve1.plus(busdPair.reserve0).plus(usdtPair.reserve1)
    let usdcWeight = usdcPair.reserve1.div(totalLiquidityETH)
    let busdWeight = busdPair.reserve0.div(totalLiquidityETH)
    let usdtWeight = usdtPair.reserve1.div(totalLiquidityETH)
    return usdcPair.token0Price
      .times(usdcWeight)
      .plus(busdPair.token1Price.times(busdWeight))
      .plus(usdtPair.token0Price.times(usdtWeight))
    // dai and USDC have been created
  } else if (usdcPair !== null && busdPair !== null) {
    let totalLiquidityETH = usdcPair.reserve1.plus(busdPair.reserve0)
    let usdcWeight = usdcPair.reserve1.div(totalLiquidityETH)
    let busdWeight = busdPair.reserve0.div(totalLiquidityETH)
    return usdcPair.token0Price.times(usdcWeight).plus(busdPair.token1Price.times(busdWeight))
    // USDC is the only pair so far
  } else if (usdcPair !== null) {
    return usdcPair.token0Price
  } else {
    return ZERO_BD
  }
}

// token where amounts should contribute to tracked volume and liquidity
let WHITELIST: string[] = [
  WONE_ADDRESS,
  '0x6983d1e6def3690c4d616b13597a09e6193ea013', // WETH
  '0xe176ebe47d621b984a73036b9da5d834411ef734', // BUSD
  '0x985458e523db3d53125813ed68c274899e9dfab4', // 1USDC
  '0xef977d2f931c1978db5f6747666fa1eacb0d0339', // 1DAI
  '0x224e64ec1bdce3870a6a6c777edd450454068fec', // UST
  '0x3c2b8be99c50593081eaa2a724f0b8285f5aba8f', // 1USDT
  '0xb2e2650dfdb7b2dec4a4455a375ffbfd926ce5fc', // FATE
  '0x553a1151f3df3620fc2b5a75a6edda629e3da350', // 1TUSD
  '0x514910771af9ca656af840dff83e8264ecf986ca', // 1LINK
  '0x7afb0e2eba6dc938945fe0f42484d3b8f442d0ac', // 1PAXG
  '0x3095c7557bcb296ccc6e363de01b760ba031f2d9', // 1WBTC
  '0x0ab43550a6915f9f67d0c454c2e90385e6497eaa', // bscBUSD
  '0xb1f6e61e1e113625593a22fa6aa94f8052bc39e0', // bscBNB
]

// minimum liquidity required to count towards tracked volume for pairs with small # of Lps
let MINIMUM_USD_THRESHOLD_NEW_PAIRS = BigDecimal.fromString('1000')

// minimum liquidity for price to get tracked
let MINIMUM_LIQUIDITY_THRESHOLD_ONE = BigDecimal.fromString('2500')

/**
 * Search through graph to find derived Eth per token.
 * @todo update to be derived ETH (add stablecoin estimates)
 **/
export function findOnePerToken(token: Token): BigDecimal {
  if (token.id == WONE_ADDRESS) {
    return ONE_BD
  }
  // loop through whitelist and check if paired with any
  for (let i = 0; i < WHITELIST.length; ++i) {
    let pairAddressResult = PairAddressMap.load(token.id.concat('-').concat(WHITELIST[i]))
    if (pairAddressResult != null) {
      let pair = Pair.load(pairAddressResult.pairAddress.toHexString())
      if (pair.token0 == token.id && pair.reserveETH.gt(MINIMUM_LIQUIDITY_THRESHOLD_ONE)) {
        let token1 = Token.load(pair.token1)
        return pair.token1Price.times(token1.derivedETH as BigDecimal) // return token1 per our token * Eth per token 1
      }
      if (pair.token1 == token.id && pair.reserveETH.gt(MINIMUM_LIQUIDITY_THRESHOLD_ONE)) {
        let token0 = Token.load(pair.token0)
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
  let bundle = Bundle.load('1')
  let price0 = token0.derivedETH.times(bundle.ethPrice)
  let price1 = token1.derivedETH.times(bundle.ethPrice)

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
  let bundle = Bundle.load('1')
  let price0 = token0.derivedETH.times(bundle.ethPrice)
  let price1 = token1.derivedETH.times(bundle.ethPrice)

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
