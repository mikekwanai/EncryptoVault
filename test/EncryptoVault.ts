import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";

import type { EncryptoVault, EncryptoVault__factory } from "../types";

describe("EncryptoVault", () => {
  let deployer: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let vault: EncryptoVault;
  let vaultAddress: string;

  beforeEach(async function () {
    if (!fhevm.isMock) {
      this.skip();
    }

    [deployer, alice, bob] = await ethers.getSigners();
    const factory = (await ethers.getContractFactory("EncryptoVault")) as EncryptoVault__factory;
    vault = (await factory.deploy()) as EncryptoVault;
    vaultAddress = await vault.getAddress();
  });

  async function createDocument(owner: HardhatEthersSigner, secret: number, name = "Doc One") {
    const encryptedInput = await fhevm.createEncryptedInput(vaultAddress, owner.address).add64(BigInt(secret)).encrypt();
    const tx = await vault.connect(owner).createDocument(name, encryptedInput.handles[0], encryptedInput.inputProof);
    await tx.wait();
  }

  it("stores document metadata and encrypted secret on creation", async function () {
    const secret = 123_456_789;
    await createDocument(alice, secret);

    const doc = await vault.getDocument(1);
    expect(doc.name).to.eq("Doc One");
    expect(doc.owner).to.eq(alice.address);
    expect(doc.encryptedBody).to.eq("");

    const decrypted = await fhevm.userDecryptEuint(FhevmType.euint64, doc.encryptedSecret, vaultAddress, alice);
    expect(decrypted).to.eq(BigInt(secret));
  });

  it("prevents unauthorized updates until access is granted", async function () {
    await createDocument(alice, 987_654_321);

    await expect(vault.connect(bob).updateDocumentBody(1, "ciphertext")).to.be.revertedWithCustomError(
      vault,
      "Unauthorized",
    );

    await vault.connect(alice).grantAccess(1, bob.address);
    await expect(vault.connect(bob).updateDocumentBody(1, "ciphertext")).to.not.be.reverted;
    const updated = await vault.getDocument(1);
    expect(updated.encryptedBody).to.eq("ciphertext");
  });

  it("tracks collaborator list and authorization flags", async function () {
    await createDocument(alice, 111_222_333, "Shared Doc");
    await vault.connect(alice).grantAccess(1, bob.address);

    const flags = await vault.isAuthorized(1, bob.address);
    expect(flags).to.eq(true);

    const collaborators = await vault.getCollaborators(1);
    expect(collaborators).to.include.members([alice.address, bob.address]);

    const documents = await vault.getDocuments();
    expect(documents.length).to.eq(1);
    expect(documents[0].name).to.eq("Shared Doc");
  });
});
