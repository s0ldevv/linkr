export const SINGLE_SIDED_LAUNCH_FACTORY_ABI = [
  "function WETH() view returns (address)",
  "function v3Factory() view returns (address)",
  "function positionManager() view returns (address)",
  "function locker() view returns (address)",
  "function treasury() view returns (address)",
  "function launchFee() view returns (uint256)",
  "function TOKEN_SUPPLY() view returns (uint256)",
  "function STARTING_TICK() view returns (int24)",
  "function RANGE_WIDTH() view returns (int24)",
  "function EXPECTED_TICK_SPACING() view returns (int24)",
  "function MAX_SALT_ATTEMPTS() view returns (uint8)",
  "function CREATOR_SHARE_BPS() view returns (uint16)",
  "function MIN_SUPPLY_USED_BPS() view returns (uint16)",
  "function GRADUATION_WETH() view returns (uint256)",
  "function launchCount() view returns (uint256)",
  "function accruedLaunchFees() view returns (uint256)",
  "function predictTokenAddress((string name,string symbol,string metadataURI,string logo,string description,(string twitter,string telegram,string discord,string website,string farcaster) socials,uint256 initialBuyWeth,bytes32 salt) p,address creator) view returns (address predicted)",
  "function previewLaunch((string name,string symbol,string metadataURI,string logo,string description,(string twitter,string telegram,string discord,string website,string farcaster) socials,uint256 initialBuyWeth,bytes32 salt) p,address creator) view returns (address predictedToken,bytes32 salt,uint8 attempt,address existingPool,bool poolInitialized,bool launchTokenIsToken0,int24 tickLower,int24 tickUpper,uint160 sqrtPriceX96)",
  "function previewLaunchWithEntropy((string name,string symbol,string metadataURI,string logo,string description,(string twitter,string telegram,string discord,string website,string farcaster) socials,uint256 initialBuyWeth,bytes32 salt) p,address creator,bytes32 entropy) view returns (address predictedToken,bytes32 salt,uint8 attempt,address existingPool,bool poolInitialized,bool launchTokenIsToken0,int24 tickLower,int24 tickUpper,uint160 sqrtPriceX96)",
  "function launch((string name,string symbol,string metadataURI,string logo,string description,(string twitter,string telegram,string discord,string website,string farcaster) socials,uint256 initialBuyWeth,bytes32 salt) p) payable returns (address token,address pool,uint256 tokenId)",
  "function launchByToken(address token) view returns (address token,address creator,address pool,uint256 positionId,int24 tickLower,int24 tickUpper,uint128 liquidity,uint256 usedLaunch,uint256 dust,uint256 initialBuyWeth,uint256 initialBuyTokensOut,uint256 graduationWeth)",
  "event LaunchSaltSelected(address indexed token,address indexed creator,bytes32 salt,uint8 attempt)",
  "event LaunchSaltSkipped(address indexed predictedToken,address indexed creator,address indexed pool,uint8 attempt,uint160 currentSqrtPriceX96,uint160 expectedSqrtPriceX96)",
  "event TokenLaunched(address indexed token,address indexed creator,address indexed pool,uint256 positionId,bool launchTokenIsToken0,int24 tickLower,int24 tickUpper,uint160 sqrtPriceX96,uint256 supply,string metadataURI,uint256 graduationWeth,uint128 liquidity,uint256 usedLaunch,uint256 dust,uint256 initialBuyWeth,uint256 initialBuyTokensOut)",
] as const;

export const LAUNCH_LOCKER_ABI = [
  "function positionManager() view returns (address)",
  "function treasury() view returns (address)",
  "function factory() view returns (address)",
  "function positions(uint256 tokenId) view returns (address creator,address token0,address token1,uint16 creatorShareBps,bool registered)",
  "function claimable(address recipient,address asset) view returns (uint256)",
  "function collect(uint256 tokenId) returns (uint256 amount0,uint256 amount1)",
  "function claim(address asset)",
] as const;

export const V3_FACTORY_ABI = [
  "function getPool(address tokenA,address tokenB,uint24 fee) view returns (address pool)",
  "function feeAmountTickSpacing(uint24 fee) view returns (int24)",
] as const;

export const V3_POOL_ABI = [
  "function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16 observationIndex,uint16 observationCardinality,uint16 observationCardinalityNext,uint8 feeProtocol,bool unlocked)",
] as const;
