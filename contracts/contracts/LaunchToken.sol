// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract LaunchToken is ERC20 {
    struct Socials {
        string twitter;
        string telegram;
        string discord;
        string website;
        string farcaster;
    }

    error ZeroAddress();

    uint256 public constant TOKEN_SUPPLY = 1_000_000_000 ether;
    address public immutable factory;
    address public immutable creator;
    string public tokenURI;
    string public logo;
    string public description;

    Socials private _socials;

    constructor(
        string memory name_,
        string memory symbol_,
        address creator_,
        string memory metadataURI_,
        string memory logo_,
        string memory description_,
        Socials memory socials_
    ) ERC20(name_, symbol_) {
        if (creator_ == address(0)) revert ZeroAddress();
        factory = msg.sender;
        creator = creator_;
        tokenURI = metadataURI_;
        logo = logo_;
        description = description_;
        _socials = socials_;
        _mint(msg.sender, TOKEN_SUPPLY);
    }

    function socials()
        external
        view
        returns (
            string memory twitter,
            string memory telegram,
            string memory discord,
            string memory website,
            string memory farcaster
        )
    {
        Socials memory values = _socials;
        return (values.twitter, values.telegram, values.discord, values.website, values.farcaster);
    }

    function getTokenInfo()
        external
        view
        returns (address tokenDeployer, string memory tokenLogo, string memory tokenDescription, Socials memory tokenSocials)
    {
        return (creator, logo, description, _socials);
    }
}
