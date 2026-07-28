// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract RevertingTreasury {
    receive() external payable {
        revert("NO_RECEIVE");
    }
}
