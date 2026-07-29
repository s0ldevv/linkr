// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {TickMath} from "./libraries/TickMath.sol";
import {LaunchToken} from "./LaunchToken.sol";
import {LaunchLocker} from "./LaunchLocker.sol";
import {INonfungiblePositionManager} from "./interfaces/INonfungiblePositionManager.sol";
import {IUniswapV3Factory} from "./interfaces/IUniswapV3Factory.sol";
import {IUniswapV3Pool, IUniswapV3PoolPrice} from "./interfaces/IUniswapV3Pool.sol";
import {IUniswapV3SwapCallback} from "./interfaces/IUniswapV3SwapCallback.sol";
import {IWETH9} from "./interfaces/IWETH9.sol";

contract LaunchFactory is ReentrancyGuard, IUniswapV3SwapCallback {
    using SafeERC20 for IERC20;

    error InvalidParams();
    error InvalidTick();
    error ExistingPoolWrongPrice(uint160 current, uint160 expected);
    error WrongTokenAmount();
    error ZeroAddress();
    error OnlyTreasury();
    error NothingToClaim();
    error FeeTransferFailed();
    error UnauthorizedSwapCallback();
    error InvalidSwapCallback();
    error InvalidPool();
    error InvalidSalt();
    error NoUsableSalt();

    struct LaunchParams {
        string name;
        string symbol;
        string metadataURI;
        uint256 initialBuyWeth;
        bytes32 salt;
    }

    struct LaunchRecord {
        address token;
        address creator;
        address pool;
        uint256 positionId;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        uint256 usedLaunch;
        uint256 dust;
        uint256 initialBuyWeth;
        uint256 initialBuyTokensOut;
        uint256 graduationWeth;
    }

    struct SaltCandidate {
        address predictedToken;
        bytes32 salt;
        uint8 attempt;
        bool launchTokenIsToken0;
        address token0;
        address token1;
        int24 startingTick;
        int24 tickLower;
        int24 tickUpper;
        uint160 sqrtPriceX96;
        address existingPool;
        bool poolInitialized;
    }

    address public immutable WETH;
    IUniswapV3Factory public immutable v3Factory;
    INonfungiblePositionManager public immutable positionManager;
    LaunchLocker public immutable locker;
    uint24 public constant POOL_FEE = 10_000;
    int24 public constant EXPECTED_TICK_SPACING = 200;
    /// Attempt 0 is deterministic for UX. Fallback attempts include execution
    /// entropy so public mempool observers cannot precompute every rescue token.
    uint8 public constant MAX_SALT_ATTEMPTS = 64;
    uint256 public constant TOKEN_SUPPLY = 1_000_000_000 ether;
    /// Starting tick when the launch token sorts as token0 (mirrored to
    /// -STARTING_TICK when it sorts as token1). 1.0001^-200400 ~= 1.98e-9 WETH
    /// per token, so the full 1e9 supply prices at ~1.98 WETH initial market
    /// cap. Must stay a multiple of TICK_SPACING.
    int24 public constant STARTING_TICK = -200_400;
    /// Selling the whole supply across the range raises
    /// supply * 1.0001^(STARTING_TICK + RANGE_WIDTH / 2) ~= 23.2 WETH,
    /// so GRADUATION_WETH (23) is reachable just before the range top.
    int24 public constant RANGE_WIDTH = 49_200;
    uint16 public constant CREATOR_SHARE_BPS = 8_000;
    uint16 public constant MIN_SUPPLY_USED_BPS = 9_900;
    uint256 public constant GRADUATION_WETH = 23 ether;
    int24 public immutable TICK_SPACING;
    address public immutable treasury;
    uint256 public immutable launchFee;
    uint256 public launchCount;
    uint256 public accruedLaunchFees;
    address private activeSwapPool;
    uint256 private activeSwapMaxWeth;
    uint256 private activeSwapPaidWeth;

    mapping(address => LaunchRecord) public launchByToken;

    event LaunchSaltSelected(address indexed token, address indexed creator, bytes32 salt, uint8 attempt);
    event LaunchSaltSkipped(
        address indexed predictedToken,
        address indexed creator,
        address indexed pool,
        uint8 attempt,
        uint160 currentSqrtPriceX96,
        uint160 expectedSqrtPriceX96
    );
    event TokenLaunched(
        address indexed token,
        address indexed creator,
        address indexed pool,
        uint256 positionId,
        bool launchTokenIsToken0,
        int24 tickLower,
        int24 tickUpper,
        uint160 sqrtPriceX96,
        uint256 supply,
        string metadataURI,
        uint256 graduationWeth,
        uint128 liquidity,
        uint256 usedLaunch,
        uint256 dust,
        uint256 initialBuyWeth,
        uint256 initialBuyTokensOut
    );
    event LaunchFeesClaimed(address indexed treasury, uint256 amount);

    constructor(
        address weth_,
        address v3Factory_,
        address positionManager_,
        address locker_,
        address treasury_,
        uint256 launchFee_
    ) {
        if (
            weth_ == address(0) || v3Factory_ == address(0) || positionManager_ == address(0)
                || locker_ == address(0) || treasury_ == address(0)
        ) revert ZeroAddress();
        if (
            weth_.code.length == 0 || v3Factory_.code.length == 0 || positionManager_.code.length == 0
                || locker_.code.length == 0
        ) revert InvalidParams();
        WETH = weth_;
        v3Factory = IUniswapV3Factory(v3Factory_);
        positionManager = INonfungiblePositionManager(positionManager_);
        locker = LaunchLocker(locker_);
        treasury = treasury_;
        launchFee = launchFee_;

        int24 spacing = IUniswapV3Factory(v3Factory_).feeAmountTickSpacing(POOL_FEE);
        if (spacing != EXPECTED_TICK_SPACING) revert InvalidParams();
        if (
            INonfungiblePositionManager(positionManager_).factory() != v3Factory_
                || INonfungiblePositionManager(positionManager_).WETH9() != weth_
                || address(LaunchLocker(locker_).positionManager()) != positionManager_
                || LaunchLocker(locker_).factory() != address(0)
        ) {
            revert InvalidParams();
        }
        TICK_SPACING = spacing;
        _validateLaunchDefaults();
    }

    function predictTokenAddress(LaunchParams calldata p, address creator) external view returns (address predicted) {
        SaltCandidate memory candidate = _findSaltCandidate(p, creator, _launchSaltEntropy());
        predicted = candidate.predictedToken;
    }

    function previewLaunch(LaunchParams calldata p, address creator)
        external
        view
        returns (
            address predictedToken,
            bytes32 salt,
            uint8 attempt,
            address existingPool,
            bool poolInitialized,
            bool launchTokenIsToken0,
            int24 tickLower,
            int24 tickUpper,
            uint160 sqrtPriceX96
        )
    {
        SaltCandidate memory candidate = _findSaltCandidate(p, creator, _launchSaltEntropy());
        return (
            candidate.predictedToken,
            candidate.salt,
            candidate.attempt,
            candidate.existingPool,
            candidate.poolInitialized,
            candidate.launchTokenIsToken0,
            candidate.tickLower,
            candidate.tickUpper,
            candidate.sqrtPriceX96
        );
    }

    function previewLaunchWithEntropy(LaunchParams calldata p, address creator, bytes32 entropy)
        external
        view
        returns (
            address predictedToken,
            bytes32 salt,
            uint8 attempt,
            address existingPool,
            bool poolInitialized,
            bool launchTokenIsToken0,
            int24 tickLower,
            int24 tickUpper,
            uint160 sqrtPriceX96
        )
    {
        SaltCandidate memory candidate = _findSaltCandidate(p, creator, entropy);
        return (
            candidate.predictedToken,
            candidate.salt,
            candidate.attempt,
            candidate.existingPool,
            candidate.poolInitialized,
            candidate.launchTokenIsToken0,
            candidate.tickLower,
            candidate.tickUpper,
            candidate.sqrtPriceX96
        );
    }

    function launch(LaunchParams calldata p)
        external
        payable
        nonReentrant
        returns (address token, address pool, uint256 tokenId)
    {
        _validateLaunchParams(p);

        SaltCandidate memory candidate = _selectSaltCandidate(p, msg.sender, _launchSaltEntropy());
        token = address(new LaunchToken{salt: candidate.salt}(p.name, p.symbol, msg.sender, p.metadataURI));
        if (token != candidate.predictedToken) revert InvalidSalt();
        if (IERC20(token).totalSupply() != TOKEN_SUPPLY) revert WrongTokenAmount();

        bool isToken0 = candidate.launchTokenIsToken0;
        int24 tickLower = candidate.tickLower;
        int24 tickUpper = candidate.tickUpper;
        uint160 sqrtPriceX96 = candidate.sqrtPriceX96;

        address token0 = candidate.token0;
        address token1 = candidate.token1;
        pool = _resolvePool(token0, token1, sqrtPriceX96);

        IERC20(token).forceApprove(address(positionManager), TOKEN_SUPPLY);

        uint256 amount0 = isToken0 ? TOKEN_SUPPLY : 0;
        uint256 amount1 = isToken0 ? 0 : TOKEN_SUPPLY;

        locker.beginMint();
        uint128 liquidity;
        uint256 used0;
        uint256 used1;
        (tokenId, liquidity, used0, used1) = positionManager.mint(
            INonfungiblePositionManager.MintParams({
                token0: token0,
                token1: token1,
                fee: POOL_FEE,
                tickLower: tickLower,
                tickUpper: tickUpper,
                amount0Desired: amount0,
                amount1Desired: amount1,
                amount0Min: 0,
                amount1Min: 0,
                recipient: address(locker),
                deadline: block.timestamp
            })
        );
        IERC20(token).forceApprove(address(positionManager), 0);

        uint256 usedLaunch = isToken0 ? used0 : used1;
        uint256 minUsed = TOKEN_SUPPLY * MIN_SUPPLY_USED_BPS / 10_000;
        if (liquidity < 1 || usedLaunch < minUsed || usedLaunch > TOKEN_SUPPLY) revert WrongTokenAmount();

        uint256 dust = IERC20(token).balanceOf(address(this));
        if (dust > 0) IERC20(token).safeTransfer(address(locker), dust);

        locker.register(tokenId, msg.sender, token0, token1, CREATOR_SHARE_BPS);

        uint256 initialBuyTokensOut = 0;
        if (p.initialBuyWeth > 0) {
            initialBuyTokensOut = _executeInitialBuy(pool, msg.sender, isToken0, p.initialBuyWeth);
        }

        launchByToken[token] = LaunchRecord(
            token,
            msg.sender,
            pool,
            tokenId,
            tickLower,
            tickUpper,
            liquidity,
            usedLaunch,
            dust,
            p.initialBuyWeth,
            initialBuyTokensOut,
            GRADUATION_WETH
        );
        launchCount++;
        accruedLaunchFees += launchFee;

        emit LaunchSaltSelected(token, msg.sender, candidate.salt, candidate.attempt);
        emit TokenLaunched(
            token,
            msg.sender,
            pool,
            tokenId,
            isToken0,
            tickLower,
            tickUpper,
            sqrtPriceX96,
            TOKEN_SUPPLY,
            p.metadataURI,
            GRADUATION_WETH,
            liquidity,
            usedLaunch,
            dust,
            p.initialBuyWeth,
            initialBuyTokensOut
        );
    }

    function claimLaunchFees() external nonReentrant {
        if (msg.sender != treasury) revert OnlyTreasury();
        uint256 amount = accruedLaunchFees;
        if (amount == 0) revert NothingToClaim();
        accruedLaunchFees = 0;
        (bool ok,) = treasury.call{value: amount}("");
        if (!ok) revert FeeTransferFailed();
        emit LaunchFeesClaimed(treasury, amount);
    }

    function _validateLaunchParams(LaunchParams calldata p) internal view {
        _validateLaunchParamFields(p);
        if (msg.value != launchFee + p.initialBuyWeth) revert InvalidParams();
        _validateLaunchDefaults();
    }

    function _validateLaunchParamFields(LaunchParams calldata p) internal pure {
        if (
            p.salt == bytes32(0) || bytes(p.name).length == 0 || bytes(p.symbol).length == 0
                || bytes(p.metadataURI).length == 0 || p.initialBuyWeth > uint256(type(int256).max)
        ) revert InvalidParams();
    }

    function _validateLaunchDefaults() internal view {
        if (
            TOKEN_SUPPLY == 0 || CREATOR_SHARE_BPS > 10_000 || MIN_SUPPLY_USED_BPS == 0
                || MIN_SUPPLY_USED_BPS > 10_000 || GRADUATION_WETH == 0
        ) {
            revert InvalidParams();
        }
        if (
            RANGE_WIDTH < TICK_SPACING || RANGE_WIDTH % TICK_SPACING != 0 || STARTING_TICK % TICK_SPACING != 0
        ) {
            revert InvalidTick();
        }
        _rangeFor(_startingTickFor(true), RANGE_WIDTH, true);
        _rangeFor(_startingTickFor(false), RANGE_WIDTH, false);
    }

    /// V3 prices are quoted token1/token0, so hitting the same WETH-per-token
    /// launch price requires mirroring the tick when WETH is token1 vs token0.
    function _startingTickFor(bool isToken0) internal pure returns (int24) {
        return isToken0 ? STARTING_TICK : -STARTING_TICK;
    }

    function _rangeFor(int24 startingTick, int24 rangeWidth, bool isToken0)
        internal
        pure
        returns (int24 tickLower, int24 tickUpper)
    {
        int256 lower = isToken0 ? int256(startingTick) : int256(startingTick) - int256(rangeWidth);
        int256 upper = isToken0 ? int256(startingTick) + int256(rangeWidth) : int256(startingTick);
        if (lower < TickMath.MIN_TICK || upper > TickMath.MAX_TICK || lower >= upper) revert InvalidTick();
        tickLower = int24(lower);
        tickUpper = int24(upper);
    }

    function _findSaltCandidate(LaunchParams calldata p, address creator, bytes32 entropy)
        internal
        view
        returns (SaltCandidate memory candidate)
    {
        if (creator == address(0)) revert ZeroAddress();
        _validateLaunchParamFields(p);
        bytes32 bytecodeHash = _launchTokenBytecodeHash(p, creator);
        for (uint8 attempt = 0; attempt < MAX_SALT_ATTEMPTS; attempt++) {
            candidate = _candidateAt(p, creator, bytecodeHash, entropy, attempt);
            if (candidate.predictedToken.code.length != 0) continue;
            (bool usable, address existingPool, bool initialized,) =
                _poolUsability(candidate.token0, candidate.token1, candidate.sqrtPriceX96);
            if (usable) {
                candidate.existingPool = existingPool;
                candidate.poolInitialized = initialized;
                return candidate;
            }
        }
        revert NoUsableSalt();
    }

    function _selectSaltCandidate(LaunchParams calldata p, address creator, bytes32 entropy)
        internal
        returns (SaltCandidate memory candidate)
    {
        if (creator == address(0)) revert ZeroAddress();
        _validateLaunchParamFields(p);
        bytes32 bytecodeHash = _launchTokenBytecodeHash(p, creator);
        for (uint8 attempt = 0; attempt < MAX_SALT_ATTEMPTS; attempt++) {
            candidate = _candidateAt(p, creator, bytecodeHash, entropy, attempt);
            if (candidate.predictedToken.code.length != 0) continue;
            (bool usable, address existingPool, bool initialized, uint160 currentSqrtPriceX96) =
                _poolUsability(candidate.token0, candidate.token1, candidate.sqrtPriceX96);

            if (usable) {
                candidate.existingPool = existingPool;
                candidate.poolInitialized = initialized;
                return candidate;
            }
            emit LaunchSaltSkipped(
                candidate.predictedToken,
                creator,
                existingPool,
                attempt,
                currentSqrtPriceX96,
                candidate.sqrtPriceX96
            );
        }
        revert NoUsableSalt();
    }

    function _candidateAt(
        LaunchParams calldata p,
        address creator,
        bytes32 bytecodeHash,
        bytes32 entropy,
        uint8 attempt
    )
        internal
        view
        returns (SaltCandidate memory candidate)
    {
        bytes32 salt = _candidateSalt(p.salt, creator, entropy, attempt);
        address predictedToken = _create2Address(salt, bytecodeHash);
        bool isToken0 = predictedToken < WETH;
        int24 startingTick = _startingTickFor(isToken0);
        (int24 tickLower, int24 tickUpper) = _rangeFor(startingTick, RANGE_WIDTH, isToken0);
        uint160 sqrtPriceX96 = TickMath.getSqrtRatioAtTick(startingTick);
        return SaltCandidate({
            predictedToken: predictedToken,
            salt: salt,
            attempt: attempt,
            launchTokenIsToken0: isToken0,
            token0: isToken0 ? predictedToken : WETH,
            token1: isToken0 ? WETH : predictedToken,
            startingTick: startingTick,
            tickLower: tickLower,
            tickUpper: tickUpper,
            sqrtPriceX96: sqrtPriceX96,
            existingPool: address(0),
            poolInitialized: false
        });
    }

    function _resolvePool(address token0, address token1, uint160 expectedSqrtPriceX96) internal returns (address pool) {
        address existing = v3Factory.getPool(token0, token1, POOL_FEE);
        if (existing == address(0)) {
            pool = positionManager.createAndInitializePoolIfNecessary(token0, token1, POOL_FEE, expectedSqrtPriceX96);
            _validatePoolIdentity(pool, token0, token1);
            return pool;
        }

        _validatePoolIdentity(existing, token0, token1);
        uint160 currentSqrtPriceX96 = IUniswapV3PoolPrice(existing).slot0();
        if (currentSqrtPriceX96 == 0) {
            pool = positionManager.createAndInitializePoolIfNecessary(token0, token1, POOL_FEE, expectedSqrtPriceX96);
            _validatePoolIdentity(pool, token0, token1);
            return pool;
        }
        if (currentSqrtPriceX96 != expectedSqrtPriceX96) {
            revert ExistingPoolWrongPrice(currentSqrtPriceX96, expectedSqrtPriceX96);
        }
        return existing;
    }

    function _poolUsability(address token0, address token1, uint160 expectedSqrtPriceX96)
        internal
        view
        returns (bool usable, address pool, bool initialized, uint160 currentSqrtPriceX96)
    {
        pool = v3Factory.getPool(token0, token1, POOL_FEE);
        if (pool == address(0)) return (true, address(0), false, 0);
        _validatePoolIdentity(pool, token0, token1);
        currentSqrtPriceX96 = IUniswapV3PoolPrice(pool).slot0();
        if (currentSqrtPriceX96 == 0) return (true, pool, false, 0);
        return (currentSqrtPriceX96 == expectedSqrtPriceX96, pool, true, currentSqrtPriceX96);
    }

    function _validatePoolIdentity(address pool, address token0, address token1) internal view {
        if (pool == address(0) || pool.code.length == 0) revert InvalidPool();
        if (
            IUniswapV3Pool(pool).token0() != token0 || IUniswapV3Pool(pool).token1() != token1
                || IUniswapV3Pool(pool).fee() != POOL_FEE
        ) {
            revert InvalidPool();
        }
    }

    function _executeInitialBuy(address pool, address creator, bool launchTokenIsToken0, uint256 amountIn)
        internal
        returns (uint256 tokensOut)
    {
        uint256 wethBefore = IERC20(WETH).balanceOf(address(this));
        IWETH9(WETH).deposit{value: amountIn}();
        bool zeroForOne = !launchTokenIsToken0;
        uint160 sqrtPriceLimitX96 = zeroForOne ? TickMath.MIN_SQRT_RATIO + 1 : TickMath.MAX_SQRT_RATIO - 1;

        activeSwapPool = pool;
        activeSwapMaxWeth = amountIn;
        activeSwapPaidWeth = 0;
        (int256 amount0, int256 amount1) = IUniswapV3Pool(pool).swap(
            creator,
            zeroForOne,
            int256(amountIn),
            sqrtPriceLimitX96,
            abi.encode(launchTokenIsToken0)
        );
        uint256 callbackPaidWeth = activeSwapPaidWeth;
        activeSwapPool = address(0);
        activeSwapMaxWeth = 0;
        activeSwapPaidWeth = 0;

        int256 launchAmount = launchTokenIsToken0 ? amount0 : amount1;
        if (launchAmount >= 0) revert InvalidSwapCallback();
        uint256 spentWeth = launchTokenIsToken0 ? uint256(amount1) : uint256(amount0);
        if (spentWeth > amountIn) revert InvalidSwapCallback();
        if (callbackPaidWeth != spentWeth) revert InvalidSwapCallback();
        tokensOut = uint256(-launchAmount);
        uint256 refundWeth = amountIn - spentWeth;
        if (refundWeth > 0) IERC20(WETH).safeTransfer(creator, refundWeth);
        if (IERC20(WETH).balanceOf(address(this)) != wethBefore) revert InvalidSwapCallback();
    }

    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external {
        if (msg.sender != activeSwapPool) revert UnauthorizedSwapCallback();
        bool launchTokenIsToken0 = abi.decode(data, (bool));
        uint256 amountToPay;
        if (launchTokenIsToken0) {
            if (amount0Delta >= 0 || amount1Delta <= 0) revert InvalidSwapCallback();
            amountToPay = uint256(amount1Delta);
        } else {
            if (amount0Delta <= 0 || amount1Delta >= 0) revert InvalidSwapCallback();
            amountToPay = uint256(amount0Delta);
        }
        uint256 paidWeth = activeSwapPaidWeth + amountToPay;
        if (paidWeth > activeSwapMaxWeth) revert InvalidSwapCallback();
        activeSwapPaidWeth = paidWeth;
        IERC20(WETH).safeTransfer(msg.sender, amountToPay);
    }

    function _launchTokenBytecodeHash(LaunchParams calldata p, address creator) internal pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(type(LaunchToken).creationCode, abi.encode(p.name, p.symbol, creator, p.metadataURI))
        );
    }

    function _launchSaltEntropy() internal view returns (bytes32) {
        // Used only for anti-grief fallback salt selection, not for economic randomness.
        return bytes32(block.prevrandao);
    }

    function _candidateSalt(bytes32 userSalt, address creator, bytes32 entropy, uint8 attempt)
        internal
        view
        returns (bytes32)
    {
        if (attempt == 0) {
            return keccak256(abi.encode(block.chainid, address(this), creator, userSalt, attempt));
        }
        if (entropy == bytes32(0)) revert NoUsableSalt();
        return keccak256(abi.encode(block.chainid, address(this), creator, userSalt, entropy, attempt));
    }

    function _create2Address(bytes32 salt, bytes32 bytecodeHash) internal view returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, bytecodeHash)))));
    }
}
