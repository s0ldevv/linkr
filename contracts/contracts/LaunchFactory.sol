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
import {IUniswapV3Pool} from "./interfaces/IUniswapV3Pool.sol";
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

    address public immutable WETH;
    IUniswapV3Factory public immutable v3Factory;
    INonfungiblePositionManager public immutable positionManager;
    LaunchLocker public immutable locker;
    uint24 public constant POOL_FEE = 10_000;
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

    mapping(address => LaunchRecord) public launchByToken;

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
        WETH = weth_;
        v3Factory = IUniswapV3Factory(v3Factory_);
        positionManager = INonfungiblePositionManager(positionManager_);
        locker = LaunchLocker(locker_);
        treasury = treasury_;
        launchFee = launchFee_;

        int24 spacing = IUniswapV3Factory(v3Factory_).feeAmountTickSpacing(POOL_FEE);
        if (spacing <= 0) revert InvalidParams();
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
        bytes32 salt = _boundSalt(p.salt, creator);
        bytes memory bytecode = abi.encodePacked(
            type(LaunchToken).creationCode,
            abi.encode(p.name, p.symbol, creator, p.metadataURI)
        );
        predicted = address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, keccak256(bytecode)))))
        );
    }

    function launch(LaunchParams calldata p)
        external
        payable
        nonReentrant
        returns (address token, address pool, uint256 tokenId)
    {
        _validateLaunchParams(p);

        bytes32 salt = _boundSalt(p.salt, msg.sender);
        token = address(new LaunchToken{salt: salt}(p.name, p.symbol, msg.sender, p.metadataURI));
        if (IERC20(token).totalSupply() != TOKEN_SUPPLY) revert WrongTokenAmount();

        bool isToken0 = token < WETH;
        int24 startingTick = _startingTickFor(isToken0);
        (int24 tickLower, int24 tickUpper) = _rangeFor(startingTick, RANGE_WIDTH, isToken0);
        uint160 sqrtPriceX96 = TickMath.getSqrtRatioAtTick(startingTick);

        address token0 = isToken0 ? token : WETH;
        address token1 = isToken0 ? WETH : token;
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
        if (liquidity == 0 || usedLaunch < minUsed || usedLaunch > TOKEN_SUPPLY) revert WrongTokenAmount();

        uint256 dust = IERC20(token).balanceOf(address(this));
        if (dust > 0) IERC20(token).safeTransfer(address(locker), dust);

        locker.register(tokenId, msg.sender, token0, token1, CREATOR_SHARE_BPS);

        uint256 initialBuyTokensOut;
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
        if (
            msg.value != launchFee + p.initialBuyWeth || bytes(p.name).length == 0 || bytes(p.symbol).length == 0
                || bytes(p.metadataURI).length == 0 || p.initialBuyWeth > uint256(type(int256).max)
        ) revert InvalidParams();
        _validateLaunchDefaults();
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

    function _resolvePool(address token0, address token1, uint160 expectedSqrtPriceX96) internal returns (address pool) {
        address existing = v3Factory.getPool(token0, token1, POOL_FEE);
        if (existing == address(0)) {
            return positionManager.createAndInitializePoolIfNecessary(token0, token1, POOL_FEE, expectedSqrtPriceX96);
        }

        (uint160 currentSqrtPriceX96,,,,,,) = IUniswapV3Pool(existing).slot0();
        if (currentSqrtPriceX96 == 0) {
            return positionManager.createAndInitializePoolIfNecessary(token0, token1, POOL_FEE, expectedSqrtPriceX96);
        }
        if (currentSqrtPriceX96 != expectedSqrtPriceX96) {
            revert ExistingPoolWrongPrice(currentSqrtPriceX96, expectedSqrtPriceX96);
        }
        return existing;
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
        (int256 amount0, int256 amount1) = IUniswapV3Pool(pool).swap(
            creator,
            zeroForOne,
            int256(amountIn),
            sqrtPriceLimitX96,
            abi.encode(launchTokenIsToken0)
        );
        activeSwapPool = address(0);

        int256 launchAmount = launchTokenIsToken0 ? amount0 : amount1;
        if (launchAmount >= 0) revert InvalidSwapCallback();
        uint256 spentWeth = launchTokenIsToken0 ? uint256(amount1) : uint256(amount0);
        if (spentWeth > amountIn) revert InvalidSwapCallback();
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
        IERC20(WETH).safeTransfer(msg.sender, amountToPay);
    }

    function _boundSalt(bytes32 userSalt, address creator) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(creator, userSalt));
    }
}
