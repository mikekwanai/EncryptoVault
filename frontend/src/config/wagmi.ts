import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { sepolia } from 'wagmi/chains';

export const config = getDefaultConfig({
  appName: 'EncryptoVault',
  projectId: '8c174f3f1a954c2396745f0c5cfa9439',
  chains: [sepolia],
  ssr: false,
});
