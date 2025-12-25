// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title EncryptoVault
/// @notice Stores encrypted documents and manages encrypted access keys with FHE
contract EncryptoVault is ZamaEthereumConfig {
    struct Document {
        string name;
        string encryptedBody;
        euint64 encryptedSecret;
        address owner;
        uint256 updatedAt;
    }

    uint256 private _documentCount;
    mapping(uint256 => Document) private _documents;
    mapping(uint256 => mapping(address => bool)) private _collaborators;
    mapping(uint256 => address[]) private _collaboratorList;

    event DocumentCreated(uint256 indexed documentId, address indexed owner, string name);
    event DocumentUpdated(uint256 indexed documentId, address indexed editor, string encryptedBody);
    event AccessGranted(uint256 indexed documentId, address indexed grantee);

    error DocumentNotFound(uint256 documentId);
    error NotDocumentOwner(address caller);
    error Unauthorized(address caller);
    error InvalidAddress();
    error EmptyName();

    function createDocument(
        string calldata name,
        externalEuint64 encryptedSecret,
        bytes calldata inputProof
    ) external returns (uint256) {
        if (bytes(name).length == 0) {
            revert EmptyName();
        }

        euint64 secret = FHE.fromExternal(encryptedSecret, inputProof);

        _documentCount += 1;
        uint256 documentId = _documentCount;

        _documents[documentId] = Document({
            name: name,
            encryptedBody: "",
            encryptedSecret: secret,
            owner: msg.sender,
            updatedAt: block.timestamp
        });

        _collaborators[documentId][msg.sender] = true;
        _collaboratorList[documentId].push(msg.sender);

        FHE.allow(secret, msg.sender);
        FHE.allowThis(secret);

        emit DocumentCreated(documentId, msg.sender, name);
        return documentId;
    }

    function grantAccess(uint256 documentId, address grantee) external {
        Document storage doc = _documents[documentId];
        if (doc.owner == address(0)) {
            revert DocumentNotFound(documentId);
        }
        if (doc.owner != msg.sender) {
            revert NotDocumentOwner(msg.sender);
        }
        if (grantee == address(0)) {
            revert InvalidAddress();
        }

        if (!_collaborators[documentId][grantee]) {
            _collaborators[documentId][grantee] = true;
            _collaboratorList[documentId].push(grantee);
        }

        FHE.allow(doc.encryptedSecret, grantee);

        emit AccessGranted(documentId, grantee);
    }

    function updateDocumentBody(uint256 documentId, string calldata encryptedBody) external {
        Document storage doc = _documents[documentId];
        if (doc.owner == address(0)) {
            revert DocumentNotFound(documentId);
        }

        if (!FHE.isSenderAllowed(doc.encryptedSecret)) {
            revert Unauthorized(msg.sender);
        }

        doc.encryptedBody = encryptedBody;
        doc.updatedAt = block.timestamp;

        FHE.allow(doc.encryptedSecret, msg.sender);

        emit DocumentUpdated(documentId, msg.sender, encryptedBody);
    }

    function getDocument(uint256 documentId) external view returns (Document memory) {
        Document memory doc = _documents[documentId];
        if (doc.owner == address(0)) {
            revert DocumentNotFound(documentId);
        }
        return doc;
    }

    function getDocuments() external view returns (Document[] memory documents) {
        documents = new Document[](_documentCount);
        for (uint256 i = 0; i < _documentCount; i++) {
            documents[i] = _documents[i + 1];
        }
    }

    function isAuthorized(uint256 documentId, address user) external view returns (bool) {
        Document memory doc = _documents[documentId];
        if (doc.owner == address(0)) {
            revert DocumentNotFound(documentId);
        }
        return _collaborators[documentId][user];
    }

    function getCollaborators(uint256 documentId) external view returns (address[] memory) {
        Document memory doc = _documents[documentId];
        if (doc.owner == address(0)) {
            revert DocumentNotFound(documentId);
        }
        return _collaboratorList[documentId];
    }

    function documentCount() external view returns (uint256) {
        return _documentCount;
    }
}
