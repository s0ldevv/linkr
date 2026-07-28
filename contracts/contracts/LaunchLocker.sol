// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {INonfungiblePositionManager} from "./interfaces/INonfungiblePositionManager.sol";

contract LaunchLocker is IERC721Receiver, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error OnlyFactory();
    error OnlyAdmin();
    error ZeroAddress();
    error FactoryAlreadySet();
    error UnknownPosition();
    error NothingToClaim();
    error InvalidSplit();
    error MintAlreadyInProgress();
    error UnexpectedNft();
    error PositionAlreadyRegistered();

    struct PositionInfo {
        address creator;
        address token0;
        address token1;
        uint16 creatorShareBps;
        bool registered;
    }

    INonfungiblePositionManager public immutable positionManager;
    address public immutable treasury;
    address public immutable admin;
    address public factory;
    bool private mintInProgress;

    mapping(uint256 => PositionInfo) public positions;
    mapping(address => mapping(address => uint256)) public claimable;

    event FactorySet(address indexed factory);
    event PositionRegistered(
        uint256 indexed tokenId,
        address indexed creator,
        address token0,
        address token1,
        uint16 creatorShareBps
    );
    event FeesCollected(uint256 indexed tokenId, uint256 amount0, uint256 amount1);
    event Claimed(address indexed recipient, address indexed token, uint256 amount);

    modifier onlyFactory() {
        if (msg.sender != factory) revert OnlyFactory();
        _;
    }

    constructor(address manager_, address treasury_, address admin_) {
        if (manager_ == address(0) || treasury_ == address(0) || admin_ == address(0)) revert ZeroAddress();
        positionManager = INonfungiblePositionManager(manager_);
        treasury = treasury_;
        admin = admin_;
    }

    function setFactory(address factory_) external {
        if (msg.sender != admin) revert OnlyAdmin();
        if (factory != address(0)) revert FactoryAlreadySet();
        if (factory_ == address(0)) revert ZeroAddress();
        factory = factory_;
        emit FactorySet(factory_);
    }

    function beginMint() external onlyFactory {
        if (mintInProgress) revert MintAlreadyInProgress();
        mintInProgress = true;
    }

    function register(uint256 tokenId, address creator, address token0, address token1, uint16 creatorShareBps)
        external
        onlyFactory
    {
        if (creator == address(0) || token0 == address(0) || token1 == address(0)) revert ZeroAddress();
        if (creatorShareBps > 10_000) revert InvalidSplit();
        if (positions[tokenId].registered) revert PositionAlreadyRegistered();
        mintInProgress = false;
        positions[tokenId] = PositionInfo(creator, token0, token1, creatorShareBps, true);
        emit PositionRegistered(tokenId, creator, token0, token1, creatorShareBps);
    }

    function collect(uint256 tokenId) external nonReentrant returns (uint256 amount0, uint256 amount1) {
        PositionInfo memory p = positions[tokenId];
        if (!p.registered) revert UnknownPosition();
        (amount0, amount1) = positionManager.collect(
            INonfungiblePositionManager.CollectParams(
                tokenId,
                address(this),
                type(uint128).max,
                type(uint128).max
            )
        );
        _credit(p.creator, p.token0, amount0, p.creatorShareBps);
        _credit(p.creator, p.token1, amount1, p.creatorShareBps);
        emit FeesCollected(tokenId, amount0, amount1);
    }

    function claim(address asset) external nonReentrant {
        uint256 amount = claimable[msg.sender][asset];
        if (amount == 0) revert NothingToClaim();
        claimable[msg.sender][asset] = 0;
        IERC20(asset).safeTransfer(msg.sender, amount);
        emit Claimed(msg.sender, asset, amount);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external view returns (bytes4) {
        if (msg.sender != address(positionManager)) revert UnexpectedNft();
        if (!mintInProgress) revert UnexpectedNft();
        return IERC721Receiver.onERC721Received.selector;
    }

    function _credit(address creator, address asset, uint256 amount, uint16 bps) internal {
        if (amount == 0) return;
        uint256 creatorAmount = amount * bps / 10_000;
        claimable[creator][asset] += creatorAmount;
        claimable[treasury][asset] += amount - creatorAmount;
    }
}
