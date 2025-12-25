import { useEffect, useMemo, useState } from 'react';
import { useAccount, useReadContract } from 'wagmi';
import { Contract } from 'ethers';
import { useZamaInstance } from '../hooks/useZamaInstance';
import { useEthersSigner } from '../hooks/useEthersSigner';
import { CONTRACT_ABI, CONTRACT_ADDRESS } from '../config/contracts';
import { Header } from './Header';
import { decryptBody, encryptBody } from '../utils/crypto';
import '../styles/VaultApp.css';

type VaultDocument = {
  name: string;
  encryptedBody: string;
  encryptedSecret: `0x${string}`;
  owner: `0x${string}`;
  updatedAt: bigint;
};

const toNumber = (value: bigint | number | undefined) => {
  if (value === undefined) return 0;
  return typeof value === 'bigint' ? Number(value) : value;
};

const formatTimestamp = (timestamp: bigint | number) => {
  const ms = toNumber(timestamp) * 1000;
  return new Date(ms).toLocaleString();
};

export function VaultApp() {
  const { address } = useAccount();
  const { instance, isLoading: zamaLoading, error: zamaError } = useZamaInstance();
  const signerPromise = useEthersSigner();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [secretForCreate, setSecretForCreate] = useState<number | null>(null);
  const [clearSecret, setClearSecret] = useState<string>('');
  const [bodyDraft, setBodyDraft] = useState('');
  const [decryptedBody, setDecryptedBody] = useState('');
  const [grantTarget, setGrantTarget] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [isGranting, setIsGranting] = useState(false);

  const { data: documentsData, refetch: refetchDocuments, isFetching: loadingDocuments } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'getDocuments',
  });

  const documents = useMemo(() => (documentsData as VaultDocument[]) || [], [documentsData]);
  const activeDocument = selectedId ? documents[selectedId - 1] : undefined;

  const { data: collaboratorData, refetch: refetchCollaborators } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'getCollaborators',
    args: selectedId ? [BigInt(selectedId)] : undefined,
    query: {
      enabled: !!selectedId,
    },
  });

  useEffect(() => {
    setClearSecret('');
    setDecryptedBody('');
    setBodyDraft('');
  }, [selectedId]);

  const generateSecret = () => {
    const randomNineDigits = Math.floor(100_000_000 + Math.random() * 900_000_000);
    setSecretForCreate(randomNineDigits);
  };

  const handleCreateDocument = async () => {
    if (!address) {
      setStatus('Connect your wallet to create a document.');
      return;
    }
    if (!instance) {
      setStatus('Encryption service is still starting up.');
      return;
    }
    const signer = signerPromise ? await signerPromise : null;
    if (!signer) {
      setStatus('No signer available from wallet.');
      return;
    }
    const chosenSecret = secretForCreate ?? Math.floor(100_000_000 + Math.random() * 900_000_000);
    if (!nameInput.trim()) {
      setStatus('Please give your document a name.');
      return;
    }

    setIsSubmitting(true);
    setStatus('Encrypting your document key with Zama...');
    try {
      const buffer = instance.createEncryptedInput(CONTRACT_ADDRESS, address);
      buffer.add64(BigInt(chosenSecret));
      const encryptedInput = await buffer.encrypt();

      const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
      const tx = await contract.createDocument(nameInput.trim(), encryptedInput.handles[0], encryptedInput.inputProof);
      await tx.wait();

      setStatus('Document stored on-chain.');
      setNameInput('');
      setSecretForCreate(null);
      await refetchDocuments();
    } catch (err) {
      console.error(err);
      setStatus('Failed to create document. Make sure you are on Sepolia and have funds for gas.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const decryptSecret = async () => {
    if (!address || !instance || !activeDocument) {
      setStatus('Missing requirements to decrypt.');
      return;
    }
    const signer = signerPromise ? await signerPromise : null;
    if (!signer) {
      setStatus('No signer available.');
      return;
    }

    setIsDecrypting(true);
    setStatus('Requesting decryption from the relayer...');
    try {
      const keypair = instance.generateKeypair();
      const startTimeStamp = Math.floor(Date.now() / 1000).toString();
      const durationDays = '7';
      const eip712 = instance.createEIP712(keypair.publicKey, [CONTRACT_ADDRESS], startTimeStamp, durationDays);

      const signature = await signer.signTypedData(
        eip712.domain,
        { UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification },
        eip712.message
      );

      const result = await instance.userDecrypt(
        [{ handle: activeDocument.encryptedSecret, contractAddress: CONTRACT_ADDRESS }],
        keypair.privateKey,
        keypair.publicKey,
        signature.replace('0x', ''),
        [CONTRACT_ADDRESS],
        address,
        startTimeStamp,
        durationDays
      );

      const recoveredSecret = result[activeDocument.encryptedSecret];
      if (!recoveredSecret) {
        throw new Error('Relayer did not return a secret');
      }

      const secretAsString = recoveredSecret.toString();
      setClearSecret(secretAsString);
      setStatus('Secret decrypted. You can now read and edit the document body.');

      if (activeDocument.encryptedBody) {
        const plainBody = await decryptBody(secretAsString, activeDocument.encryptedBody);
        setDecryptedBody(plainBody);
        setBodyDraft(plainBody);
      }
    } catch (err) {
      console.error(err);
      setStatus('Failed to decrypt. Ensure you have been granted access.');
    } finally {
      setIsDecrypting(false);
    }
  };

  const updateBody = async () => {
    if (!activeDocument || !clearSecret) {
      setStatus('Decrypt the secret before saving.');
      return;
    }
    const signer = signerPromise ? await signerPromise : null;
    if (!signer) {
      setStatus('No signer available.');
      return;
    }

    setIsUpdating(true);
    setStatus('Encrypting document body and sending transaction...');
    try {
      const encryptedPayload = await encryptBody(clearSecret, bodyDraft);
      const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
      const tx = await contract.updateDocumentBody(activeDocumentIndex(), encryptedPayload);
      await tx.wait();

      setDecryptedBody(bodyDraft);
      setStatus('Document updated on-chain.');
      await refetchDocuments();
    } catch (err) {
      console.error(err);
      setStatus('Update failed. Confirm you have ACL to this document.');
    } finally {
      setIsUpdating(false);
    }
  };

  const grantAccess = async () => {
    if (!grantTarget || !activeDocument) {
      setStatus('Enter an address to grant access.');
      return;
    }
    const signer = signerPromise ? await signerPromise : null;
    if (!signer) {
      setStatus('No signer available.');
      return;
    }

    setIsGranting(true);
    setStatus('Granting access...');
    try {
      const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
      const tx = await contract.grantAccess(activeDocumentIndex(), grantTarget);
      await tx.wait();
      setStatus('Access granted. Collaborator can now decrypt the secret.');
      setGrantTarget('');
      await refetchCollaborators();
    } catch (err) {
      console.error(err);
      setStatus('Unable to grant access. Only the owner can share the document.');
    } finally {
      setIsGranting(false);
    }
  };

  const activeDocumentIndex = () => (selectedId ? BigInt(selectedId) : BigInt(0));

  return (
    <div className="vault-app">
      <Header />

      <section className="hero">
        <div>
          <p className="eyebrow">Fully Homomorphic Encryption</p>
          <h2>Encrypt secrets with Zama and store collaborative documents on-chain.</h2>
          <p className="lede">
            Generate a 9-digit passcode, encrypt it through the relayer, and manage document edits with explicit ACL.
          </p>
          <div className="pill-row">
            <span>Writes via ethers</span>
            <span>Reads via viem</span>
            <span>No mocks or local storage</span>
          </div>
        </div>
      </section>

      <div className="grid">
        <div className="panel">
          <div className="panel-header">
            <div>
              <p className="panel-label">Create</p>
              <h3>New encrypted document</h3>
              <p className="muted">A random 9-digit secret is encrypted with FHE and stored alongside your document.</p>
            </div>
          </div>

          <div className="form-group">
            <label>Document name</label>
            <input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="Project brief, legal draft, release notes..."
            />
          </div>

          <div className="secret-row">
            <div>
              <p className="muted">Document secret (9 digits)</p>
              <div className="secret-box">{secretForCreate ?? 'Tap generate to create a secret'}</div>
            </div>
            <button className="ghost" type="button" onClick={generateSecret}>
              Generate secret
            </button>
          </div>

          <button className="primary" disabled={isSubmitting || zamaLoading} onClick={handleCreateDocument}>
            {isSubmitting ? 'Saving...' : 'Encrypt & Save'}
          </button>
          {zamaLoading && <p className="muted">Initializing Zama relayer...</p>}
          {zamaError && <p className="error">Relayer error: {zamaError}</p>}
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <p className="panel-label">Documents</p>
              <h3>On-chain records</h3>
              <p className="muted">Select a document to decrypt its secret and edit the encrypted body.</p>
            </div>
            <span className="badge">{documents.length} stored</span>
          </div>

          {loadingDocuments ? (
            <p className="muted">Loading documents...</p>
          ) : documents.length === 0 ? (
            <p className="muted">No documents yet. Create one above to get started.</p>
          ) : (
            <div className="document-list">
              {documents.map((doc, idx) => (
                <button
                  key={`${doc.name}-${idx}`}
                  className={`document-card ${selectedId === idx + 1 ? 'active' : ''}`}
                  onClick={() => setSelectedId(idx + 1)}
                >
                  <div className="doc-headline">
                    <div>
                      <h4>{doc.name}</h4>
                      <p className="muted">Owner: {doc.owner.slice(0, 6)}...{doc.owner.slice(-4)}</p>
                    </div>
                    <span className="stamp">{formatTimestamp(doc.updatedAt)}</span>
                  </div>
                  <p className="muted">
                    {doc.encryptedBody ? 'Encrypted body saved' : 'Body empty — decrypt to start writing'}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {activeDocument && (
        <div className="grid detail-grid">
          <div className="panel">
            <div className="panel-header">
              <div>
                <p className="panel-label">Decrypt</p>
                <h3>{activeDocument.name}</h3>
                <p className="muted">Request ACL decryption for the secret A, then edit the encrypted body.</p>
              </div>
              <span className="badge">{selectedId ? `#${selectedId}` : ''}</span>
            </div>

            <div className="info-row">
              <div>
                <p className="muted">Owner</p>
                <p className="strong">{activeDocument.owner}</p>
              </div>
              <div>
                <p className="muted">Last update</p>
                <p className="strong">{formatTimestamp(activeDocument.updatedAt)}</p>
              </div>
              <div>
                <p className="muted">Secret</p>
                <p className="strong">{clearSecret || 'Locked'}</p>
              </div>
            </div>

            <button className="primary" disabled={isDecrypting} onClick={decryptSecret}>
              {isDecrypting ? 'Decrypting...' : 'Decrypt secret A'}
            </button>

            <div className="editor">
              <label>Document body (encrypted with A)</label>
              <textarea
                value={bodyDraft}
                placeholder="Type your content, then encrypt with the secret to persist on-chain."
                onChange={(e) => setBodyDraft(e.target.value)}
                disabled={!clearSecret || isUpdating}
              />
              <div className="editor-actions">
                <button className="ghost" type="button" onClick={() => setBodyDraft(decryptedBody)}>
                  Reset to last saved
                </button>
                <button className="primary" disabled={!clearSecret || isUpdating} onClick={updateBody}>
                  {isUpdating ? 'Updating...' : 'Encrypt & Save'}
                </button>
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <div>
                <p className="panel-label">Share</p>
                <h3>Grant decryption rights</h3>
                <p className="muted">Share secret A with a collaborator so they can decrypt and edit.</p>
              </div>
            </div>

            <div className="form-group">
              <label>Collaborator address</label>
              <input
                value={grantTarget}
                onChange={(e) => setGrantTarget(e.target.value)}
                placeholder="0x collaborator address"
              />
            </div>
            <button className="primary" disabled={isGranting} onClick={grantAccess}>
              {isGranting ? 'Granting...' : 'Allow access to A'}
            </button>

            <div className="collaborator-list">
              <p className="muted">Collaborators with ACL</p>
              {(collaboratorData as string[] | undefined)?.length ? (
                (collaboratorData as string[]).map((entry) => (
                  <div className="pill" key={entry}>
                    {entry}
                  </div>
                ))
              ) : (
                <p className="muted">Only the owner has access so far.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {status && <div className="status-bar">{status}</div>}
    </div>
  );
}
