import { Chain } from 'viem';

export const worldChainSepolia: Chain = {
  id: 4801,
  name: 'World Chain Sepolia',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://worldchain-sepolia.g.alchemy.com/public'] },
    public: { http: ['https://worldchain-sepolia.g.alchemy.com/public'] },
  },
  blockExplorers: {
    default: { name: 'WorldScan', url: 'https://sepolia.worldscan.io' },
  },
  testnet: true,
}; 