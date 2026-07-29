// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockUniswapV3Pool} from "./MockUniswapV3Pool.sol";

contract MockUniswapV3Factory {
    int24 public spacing = 200;
    mapping(bytes32 => address) public pools;

    function feeAmountTickSpacing(uint24 fee) external view returns (int24) {
        return fee == 10_000 ? spacing : int24(0);
    }

    function setSpacing(int24 spacing_) external {
        spacing = spacing_;
    }

    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool) {
        (address token0, address token1) = _sort(tokenA, tokenB);
        return pools[_key(token0, token1, fee)];
    }

    function createPool(address tokenA, address tokenB, uint24 fee) external returns (address pool) {
        (address token0, address token1) = _sort(tokenA, tokenB);
        bytes32 key = _key(token0, token1, fee);
        pool = pools[key];
        if (pool == address(0)) {
            pool = address(new MockUniswapV3Pool(token0, token1, fee));
            pools[key] = pool;
        }
    }

    function setPool(address tokenA, address tokenB, uint24 fee, address pool) external {
        (address token0, address token1) = _sort(tokenA, tokenB);
        pools[_key(token0, token1, fee)] = pool;
    }

    function _sort(address tokenA, address tokenB) internal pure returns (address token0, address token1) {
        return tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
    }

    function _key(address token0, address token1, uint24 fee) internal pure returns (bytes32) {
        return keccak256(abi.encode(token0, token1, fee));
    }
}
