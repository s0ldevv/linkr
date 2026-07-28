// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {INonfungiblePositionManager} from "../interfaces/INonfungiblePositionManager.sol";
import {MockUniswapV3Factory} from "./MockUniswapV3Factory.sol";
import {MockUniswapV3Pool} from "./MockUniswapV3Pool.sol";

contract MockNonfungiblePositionManager is ERC721, INonfungiblePositionManager {
    using SafeERC20 for IERC20;

    struct PositionData {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        uint128 tokensOwed0;
        uint128 tokensOwed1;
    }

    MockUniswapV3Factory public immutable factoryContract;
    address public immutable WETH9Address;
    uint256 public nextTokenId = 1;
    uint128 public nextLiquidity = 1_000_000;
    uint256 public nextAmount0;
    uint256 public nextAmount1;
    bool public useDesiredAmounts = true;

    MintParams public lastMintParams;
    mapping(uint256 => PositionData) public positionData;

    constructor(address factory_, address weth_) ERC721("Mock V3 Positions", "MV3") {
        factoryContract = MockUniswapV3Factory(factory_);
        WETH9Address = weth_;
    }

    function factory() external view returns (address) {
        return address(factoryContract);
    }

    function WETH9() external view returns (address) {
        return WETH9Address;
    }

    function setNextMintResult(uint128 liquidity, uint256 amount0, uint256 amount1, bool useDesired) external {
        nextLiquidity = liquidity;
        nextAmount0 = amount0;
        nextAmount1 = amount1;
        useDesiredAmounts = useDesired;
    }

    function setCollectAmounts(uint256 tokenId, uint128 amount0, uint128 amount1) external {
        positionData[tokenId].tokensOwed0 = amount0;
        positionData[tokenId].tokensOwed1 = amount1;
    }

    function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96)
        external
        payable
        returns (address pool)
    {
        pool = factoryContract.getPool(token0, token1, fee);
        if (pool == address(0)) {
            pool = factoryContract.createPool(token0, token1, fee);
        }
        (uint160 current,,,,,,) = MockUniswapV3Pool(pool).slot0();
        if (current == 0) {
            MockUniswapV3Pool(pool).initialize(sqrtPriceX96);
        }
    }

    function mint(MintParams calldata params)
        external
        payable
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
    {
        tokenId = nextTokenId++;
        liquidity = nextLiquidity;
        amount0 = useDesiredAmounts ? params.amount0Desired : nextAmount0;
        amount1 = useDesiredAmounts ? params.amount1Desired : nextAmount1;
        address pool = factoryContract.getPool(params.token0, params.token1, params.fee);
        if (pool == address(0)) {
            pool = factoryContract.createPool(params.token0, params.token1, params.fee);
        }
        if (amount0 > 0) IERC20(params.token0).safeTransferFrom(msg.sender, pool, amount0);
        if (amount1 > 0) IERC20(params.token1).safeTransferFrom(msg.sender, pool, amount1);
        lastMintParams = params;
        positionData[tokenId] = PositionData(
            params.token0,
            params.token1,
            params.fee,
            params.tickLower,
            params.tickUpper,
            liquidity,
            0,
            0
        );
        _safeMint(params.recipient, tokenId);
    }

    function mintExternal(address recipient, address token0, address token1) external returns (uint256 tokenId) {
        tokenId = nextTokenId++;
        positionData[tokenId] = PositionData(token0, token1, 10_000, 0, 200, 1, 0, 0);
        _safeMint(recipient, tokenId);
    }

    function collect(CollectParams calldata params) external payable returns (uint256 amount0, uint256 amount1) {
        PositionData storage p = positionData[params.tokenId];
        amount0 = p.tokensOwed0;
        amount1 = p.tokensOwed1;
        p.tokensOwed0 = 0;
        p.tokensOwed1 = 0;
        if (amount0 > 0) IERC20(p.token0).safeTransfer(params.recipient, amount0);
        if (amount1 > 0) IERC20(p.token1).safeTransfer(params.recipient, amount1);
    }

    function positions(uint256 tokenId)
        external
        view
        returns (
            uint96 nonce,
            address operator,
            address token0,
            address token1,
            uint24 fee,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity,
            uint256 feeGrowthInside0LastX128,
            uint256 feeGrowthInside1LastX128,
            uint128 tokensOwed0,
            uint128 tokensOwed1
        )
    {
        PositionData memory p = positionData[tokenId];
        return (0, address(0), p.token0, p.token1, p.fee, p.tickLower, p.tickUpper, p.liquidity, 0, 0, p.tokensOwed0, p.tokensOwed1);
    }
}
