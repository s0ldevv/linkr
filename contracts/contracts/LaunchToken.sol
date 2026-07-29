// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract LaunchToken is ERC20 {
    error ZeroAddress();

    uint256 public constant TOKEN_SUPPLY = 1_000_000_000 ether;
    address public immutable factory;
    address public immutable creator;
    string public tokenURI;

    constructor(string memory name_, string memory symbol_, address creator_, string memory metadataURI_) ERC20(name_, symbol_) {
        if (creator_ == address(0)) revert ZeroAddress();
        factory = msg.sender;
        creator = creator_;
        tokenURI = metadataURI_;
        _mint(msg.sender, TOKEN_SUPPLY);
    }
}
