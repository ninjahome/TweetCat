// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./AdVault.sol";

/**
 * @title AdFactory
 * @dev Factory for deploying AdVault contracts using CREATE2.
 */
contract AdFactory {
    event AdDeployed(address indexed adAddress, address indexed owner, string adId);

    /**
     * @dev Deploys a new AdVault contract deterministically.
     * @param _platform The TweetCat platform address.
     * @param _usdc The USDC token address.
     * @param _adId A unique string identifier for the ad.
     * @param _salt A salt for CREATE2 (can be derived from adId).
     */
    function deployAd(
        address _platform,
        address _usdc,
        string calldata _adId,
        bytes32 _salt
    ) external returns (address) {
        // Deploy AdVault using CREATE2
        AdVault newAd = new AdVault{salt: _salt}(msg.sender, _platform, _usdc);
        
        address adAddress = address(newAd);
        emit AdDeployed(adAddress, msg.sender, _adId);
        
        return adAddress;
    }

    /**
     * @dev Computes the address of an AdVault before deployment.
     */
    function computeAddress(
        address _owner,
        address _platform,
        address _usdc,
        bytes32 _salt
    ) external view returns (address) {
        bytes memory bytecode = abi.encodePacked(
            type(AdVault).creationCode,
            abi.encode(_owner, _platform, _usdc)
        );
        bytes32 hash = keccak256(
            abi.encodePacked(
                bytes1(0xff),
                address(this),
                _salt,
                keccak256(bytecode)
            )
        );
        return address(uint160(uint256(hash)));
    }
}
