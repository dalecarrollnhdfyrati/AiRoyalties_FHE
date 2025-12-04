// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract AiRoyalties_FHE is SepoliaConfig {
    struct EncryptedContribution {
        uint256 id;
        euint32 encryptedComputeHours;  // Encrypted compute hours contributed
        euint32 encryptedDataQuality;   // Encrypted data quality score
        euint32 encryptedModelImpact;   // Encrypted model improvement impact
        uint256 timestamp;
        bytes32 contributorHash;       // Hashed contributor identifier
    }

    struct RoyaltyDistribution {
        euint32 encryptedShare;
        euint32 encryptedPaymentAmount;
        ebool isClaimed;
    }

    struct DecryptedRoyalty {
        uint32 sharePercentage;
        uint256 paymentAmount;
        bool isRevealed;
    }

    uint256 public contributionCount;
    uint256 public totalRewardPool;
    mapping(uint256 => EncryptedContribution) public contributions;
    mapping(bytes32 => RoyaltyDistribution) public royaltyDistributions;
    mapping(uint256 => DecryptedRoyalty) public decryptedRoyalties;
    
    mapping(uint256 => uint256) private requestToContributionId;
    mapping(uint256 => bytes32) private requestToContributorHash;
    
    event ContributionRecorded(uint256 indexed id, bytes32 contributorHash, uint256 timestamp);
    event RoyaltyCalculationRequested(uint256 indexed contributionId);
    event RoyaltyDecrypted(uint256 indexed contributionId);
    event RewardPoolDeposited(uint256 amount);

    modifier onlyAuthorized() {
        _;
    }

    function depositRewardPool() public payable onlyAuthorized {
        totalRewardPool += msg.value;
        emit RewardPoolDeposited(msg.value);
    }

    function submitEncryptedContribution(
        euint32 computeHours,
        euint32 dataQuality,
        euint32 modelImpact,
        bytes32 contributorHash
    ) public onlyAuthorized {
        contributionCount += 1;
        uint256 newId = contributionCount;
        
        contributions[newId] = EncryptedContribution({
            id: newId,
            encryptedComputeHours: computeHours,
            encryptedDataQuality: dataQuality,
            encryptedModelImpact: modelImpact,
            timestamp: block.timestamp,
            contributorHash: contributorHash
        });
        
        emit ContributionRecorded(newId, contributorHash, block.timestamp);
    }

    function calculateRoyaltyShare(uint256 contributionId) public onlyAuthorized {
        EncryptedContribution storage contrib = contributions[contributionId];
        
        bytes32[] memory ciphertexts = new bytes32[](3);
        ciphertexts[0] = FHE.toBytes32(contrib.encryptedComputeHours);
        ciphertexts[1] = FHE.toBytes32(contrib.encryptedDataQuality);
        ciphertexts[2] = FHE.toBytes32(contrib.encryptedModelImpact);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.processRoyaltyCalculation.selector);
        requestToContributionId[reqId] = contributionId;
        
        emit RoyaltyCalculationRequested(contributionId);
    }

    function processRoyaltyCalculation(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 contributionId = requestToContributionId[requestId];
        require(contributionId != 0, "Invalid request");
        
        EncryptedContribution storage contrib = contributions[contributionId];
        require(!royaltyDistributions[contrib.contributorHash].isClaimed, "Already processed");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        (uint32 computeHours, uint32 dataQuality, uint32 modelImpact) = 
            abi.decode(cleartexts, (uint32, uint32, uint32));
        
        uint32 share = calculateSharePercentage(computeHours, dataQuality, modelImpact);
        uint256 payment = (totalRewardPool * share) / 10000; // Basis points
        
        royaltyDistributions[contrib.contributorHash] = RoyaltyDistribution({
            encryptedShare: FHE.asEuint32(share),
            encryptedPaymentAmount: FHE.asEuint32(uint32(payment)),
            isClaimed: FHE.asEbool(false)
        });
        
        decryptedRoyalties[contributionId] = DecryptedRoyalty({
            sharePercentage: share,
            paymentAmount: payment,
            isRevealed: true
        });
        
        emit RoyaltyDecrypted(contributionId);
    }

    function claimRoyalty(bytes32 contributorHash) public {
        RoyaltyDistribution storage dist = royaltyDistributions[contributorHash];
        require(!FHE.decrypt(dist.isClaimed), "Already claimed");
        
        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(dist.encryptedPaymentAmount);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.processRoyaltyPayment.selector);
        requestToContributorHash[reqId] = contributorHash;
    }

    function processRoyaltyPayment(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        bytes32 contributorHash = requestToContributorHash[requestId];
        require(contributorHash != bytes32(0), "Invalid request");
        
        RoyaltyDistribution storage dist = royaltyDistributions[contributorHash];
        require(!FHE.decrypt(dist.isClaimed), "Already processed");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        uint32 amount = abi.decode(cleartexts, (uint32));
        
        // In a real implementation, send funds to contributor
        // payable(contributor).transfer(amount);
        
        dist.isClaimed = FHE.asEbool(true);
    }

    function getDecryptedRoyalty(uint256 contributionId) public view returns (
        uint32 share,
        uint256 amount,
        bool isRevealed
    ) {
        DecryptedRoyalty storage r = decryptedRoyalties[contributionId];
        return (r.sharePercentage, r.paymentAmount, r.isRevealed);
    }

    function calculateSharePercentage(
        uint32 computeHours,
        uint32 dataQuality,
        uint32 modelImpact
    ) private pure returns (uint32) {
        return (computeHours * 40 + dataQuality * 35 + modelImpact * 25) / 100;
    }

    function bytes32ToUint(bytes32 b) private pure returns (uint256) {
        return uint256(b);
    }
}