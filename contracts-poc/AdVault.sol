// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title AdVault
 * @dev A simple vault for holding USDC for a specific ad campaign.
 */
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract AdVault {
    address public immutable owner;    // The Advertiser
    address public immutable platform; // TweetCat Platform authorized address
    address public immutable usdc;     // USDC Token address

    constructor(address _owner, address _platform, address _usdc) {
        owner = _owner;
        platform = _platform;
        usdc = _usdc;
    }

    /**
     * @dev Payout rewards to performers. Only callable by the platform.
     */
    function payout(address recipient, uint256 amount) external {
        require(msg.sender == platform, "Only platform can authorize payout");
        require(IERC20(usdc).transfer(recipient, amount), "Transfer failed");
    }

    /**
     * @dev Refund remaining balance to the advertiser. Only callable by the owner.
     */
    function refund() external {
        require(msg.sender == owner, "Only owner can refund");
        uint256 balance = IERC20(usdc).balanceOf(address(this));
        require(IERC20(usdc).transfer(owner, balance), "Refund failed");
    }
}
