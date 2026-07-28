// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TickMath} from "../libraries/TickMath.sol";

contract TickMathHarness {
    function minTick() external pure returns (int24) {
        return TickMath.MIN_TICK;
    }

    function maxTick() external pure returns (int24) {
        return TickMath.MAX_TICK;
    }

    function minSqrtRatio() external pure returns (uint160) {
        return TickMath.MIN_SQRT_RATIO;
    }

    function maxSqrtRatio() external pure returns (uint160) {
        return TickMath.MAX_SQRT_RATIO;
    }

    function getSqrtRatioAtTick(int24 tick) external pure returns (uint160) {
        return TickMath.getSqrtRatioAtTick(tick);
    }
}
