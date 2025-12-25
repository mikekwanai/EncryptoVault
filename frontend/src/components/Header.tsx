import { ConnectButton } from '@rainbow-me/rainbowkit';
import '../styles/Header.css';

export function Header() {
  return (
    <header className="header">
      <div className="header-container">
        <div className="brand">
          <div className="logo-dot" />
          <div>
            <p className="brand-overline">EncryptoVault</p>
            <h1>Encrypted documents with Zama FHE</h1>
            <p className="brand-subtitle">Store document secrets and ACLs directly on Sepolia.</p>
          </div>
        </div>
        <ConnectButton label="Connect wallet" chainStatus="icon" showBalance={false} />
      </div>
    </header>
  );
}
