// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IUniswapV3SwapCallback} from "../interfaces/IUniswapV3SwapCallback.sol";

contract MockUniswapV3Pool {
    using SafeERC20 for IERC20;

    address public immutable token0;
    address public immutable token1;
    uint160 private sqrtPriceX96_;
    int24 private tick_;
    int256 public nextSwapAmount0;
    int256 public nextSwapAmount1;
    bool public useNextSwapAmounts;

    constructor(address token0_, address token1_) {
        token0 = token0_;
        token1 = token1_;
    }

    function initialize(uint160 sqrtPriceX96) external {
        require(sqrtPriceX96_ == 0, "ALREADY_INITIALIZED");
        sqrtPriceX96_ = sqrtPriceX96;
    }

    function setSlot0(uint160 sqrtPriceX96, int24 tick) external {
        sqrtPriceX96_ = sqrtPriceX96;
        tick_ = tick;
    }

    function setNextSwap(int256 amount0, int256 amount1, bool useNext) external {
        nextSwapAmount0 = amount0;
        nextSwapAmount1 = amount1;
        useNextSwapAmounts = useNext;
    }

    function slot0()
        external
        view
        returns (
            uint160 sqrtPriceX96,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint8 feeProtocol,
            bool unlocked
        )
    {
        return (sqrtPriceX96_, tick_, 0, 0, 0, 0, true);
    }

    function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160, bytes calldata data)
        external
        returns (int256 amount0, int256 amount1)
    {
        require(amountSpecified > 0, "EXACT_INPUT_ONLY");
        if (useNextSwapAmounts) {
            amount0 = nextSwapAmount0;
            amount1 = nextSwapAmount1;
        } else if (zeroForOne) {
            amount0 = amountSpecified;
            amount1 = -amountSpecified;
        } else {
            amount0 = -amountSpecified;
            amount1 = amountSpecified;
        }

        IUniswapV3SwapCallback(msg.sender).uniswapV3SwapCallback(amount0, amount1, data);
        if (amount0 < 0) IERC20(token0).safeTransfer(recipient, uint256(-amount0));
        if (amount1 < 0) IERC20(token1).safeTransfer(recipient, uint256(-amount1));
    }
}
