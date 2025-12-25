import { FhevmType } from "@fhevm/hardhat-plugin";
import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";

const DOCUMENT_CONTRACT = "EncryptoVault";

task("task:vault-address", "Prints the EncryptoVault address").setAction(async (_taskArguments: TaskArguments, hre) => {
  const { deployments } = hre;
  const deployment = await deployments.get(DOCUMENT_CONTRACT);
  console.log(`EncryptoVault address is ${deployment.address}`);
});

task("task:create-document", "Creates a new encrypted document")
  .addParam("name", "Document name")
  .addOptionalParam("secret", "Optional 9 digit secret to encrypt")
  .setAction(async (taskArguments: TaskArguments, hre) => {
    const { ethers, deployments, fhevm } = hre;
    await fhevm.initializeCLIApi();

    const { address } = await deployments.get(DOCUMENT_CONTRACT);
    const [signer] = await ethers.getSigners();

    const randomSecret =
      taskArguments.secret !== undefined
        ? parseInt(taskArguments.secret as string, 10)
        : Math.floor(1_000_000_00 + Math.random() * 9_000_000_00);
    if (!Number.isInteger(randomSecret) || randomSecret < 0) {
      throw new Error("Secret must be a positive integer");
    }

    const encryptedInput = await fhevm
      .createEncryptedInput(address, signer.address)
      .add64(BigInt(randomSecret))
      .encrypt();

    const contract = await ethers.getContractAt(DOCUMENT_CONTRACT, address);
    const tx = await contract
      .connect(signer)
      .createDocument(taskArguments.name, encryptedInput.handles[0], encryptedInput.inputProof);
    console.log(`Waiting for createDocument tx ${tx.hash}...`);
    await tx.wait();
    console.log(`Document created with secret ${randomSecret}`);
  });

task("task:grant-access", "Grants access to a document")
  .addParam("id", "Document id")
  .addParam("user", "Address to grant access")
  .setAction(async (taskArguments: TaskArguments, hre) => {
    const { ethers, deployments } = hre;
    const { address } = await deployments.get(DOCUMENT_CONTRACT);
    const [signer] = await ethers.getSigners();

    const contract = await ethers.getContractAt(DOCUMENT_CONTRACT, address);
    const tx = await contract.connect(signer).grantAccess(Number(taskArguments.id), taskArguments.user);
    console.log(`Waiting for grantAccess tx ${tx.hash}...`);
    await tx.wait();
    console.log(`Access granted to ${taskArguments.user} on document ${taskArguments.id}`);
  });

task("task:decrypt-secret", "Decrypts a document secret for the caller (requires ACL)")
  .addParam("id", "Document id")
  .setAction(async (taskArguments: TaskArguments, hre) => {
    const { ethers, deployments, fhevm } = hre;
    await fhevm.initializeCLIApi();

    const { address } = await deployments.get(DOCUMENT_CONTRACT);
    const [signer] = await ethers.getSigners();

    const contract = await ethers.getContractAt(DOCUMENT_CONTRACT, address);
    const document = await contract.getDocument(Number(taskArguments.id));

    const secret = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      document.encryptedSecret,
      address,
      signer
    );
    console.log(`Document ${taskArguments.id} name="${document.name}" secret=${secret.toString()}`);
  });

task("task:document", "Prints document metadata")
  .addParam("id", "Document id")
  .setAction(async (taskArguments: TaskArguments, hre) => {
    const { ethers, deployments } = hre;
    const { address } = await deployments.get(DOCUMENT_CONTRACT);
    const contract = await ethers.getContractAt(DOCUMENT_CONTRACT, address);
    const document = await contract.getDocument(Number(taskArguments.id));
    console.log({
      name: document.name,
      owner: document.owner,
      updatedAt: Number(document.updatedAt),
      encryptedBody: document.encryptedBody,
      encryptedSecret: document.encryptedSecret,
    });
  });
